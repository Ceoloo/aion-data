import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDataLayer, type DataLayer } from '../../src/index.js';
import { createTestDataLayer, ensureMigrated, truncateAll, testConnectionString } from '../setup/test-db.js';
import { makeHuman } from '../setup/fixtures.js';

const ROLE = 'aion_forge_audit_probe';
const PASSWORD = 'aion_forge_audit_probe';
function url() {
  const u = new URL(testConnectionString()); u.username=ROLE; u.password=PASSWORD; return u.toString();
}

describe('Forge append-only audit (real PostgreSQL)',()=>{
  let admin:DataLayer, app:DataLayer, unscoped:DataLayer;
  let tenant:string|undefined;
  let actorId:string;
  const input=(overrides:Record<string,unknown>={})=>({
    eventId:randomUUID(),schemaVersion:'forge.audit.v1' as const,recordedAt:'2026-11-07T00:00:00Z',
    type:'forge.session.requested',requestId:'forge-12345678-1234',tenantId:'tenant-a',
    principalId:'operator-1',actorId,workspaceId:'work-1',template:'reviewer' as const,
    ...overrides
  });
  beforeAll(async()=>{
    admin=createTestDataLayer();
    await ensureMigrated(admin);
    await admin.pool.query("DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '"+ROLE+"') THEN CREATE ROLE "+ROLE+" LOGIN PASSWORD '"+PASSWORD+"' NOSUPERUSER NOBYPASSRLS; END IF; END $do$");
    await admin.pool.query("GRANT USAGE ON SCHEMA public TO "+ROLE);
    await admin.pool.query("REVOKE ALL ON public.forge_audit_events FROM "+ROLE);
    await admin.pool.query("GRANT SELECT, INSERT ON public.forge_audit_events TO "+ROLE);
    app=createDataLayer({connectionString:url(),tenantContext:()=>tenant});
    unscoped=createDataLayer({connectionString:url()});
  });
  beforeEach(async()=>{
    tenant=undefined;
    await truncateAll(admin);
    const actor=makeHuman('Forge Proof Operator');
    await admin.actors.save(actor);
    actorId=actor.actorId;
  });
  afterAll(async()=>{await app.close();await unscoped.close();await admin.close();});
  it('acks a committed record and safely replays identical event ID',async()=>{
    tenant='tenant-a';
    const record=input();
    expect(await app.forgeAudit.append(record)).toEqual({eventId:record.eventId,committed:true});
    expect(await app.forgeAudit.append(record)).toEqual({eventId:record.eventId,committed:true});
    const {rows}=await admin.pool.query('SELECT count(*)::int AS count FROM forge_audit_events WHERE event_id=$1',[record.eventId]);
    expect(rows[0]?.count).toBe(1);
  });
  it('requires bound tenant; cross-tenant writes and reads fail closed',async()=>{
    const record=input();
    await expect(unscoped.forgeAudit.append(record)).rejects.toThrow();
    tenant='tenant-b';
    await expect(app.forgeAudit.append(record)).rejects.toThrow();
    tenant='tenant-a';
    await app.forgeAudit.append(record);
    tenant='tenant-b';
    // Bind tenant explicitly on the non-owner PG connection (raw pool is NOT
    // TenantScopedPool); this tests RLS with the correct security context.
    const client=await app.pool.connect();
    try {
      await client.query('SELECT set_config($1,$2,false)', ['aion.tenant_id','tenant-b']);
      const denied=await client.query('SELECT event_id FROM forge_audit_events WHERE event_id=$1',[record.eventId]);
      expect(denied.rows).toHaveLength(0);
      await client.query('SELECT set_config($1,$2,false)', ['aion.tenant_id','tenant-a']);
      const visible=await client.query('SELECT event_id FROM forge_audit_events WHERE event_id=$1',[record.eventId]);
      expect(visible.rows).toHaveLength(1);
    } finally {client.release();}
  });
  it('detects same ID conflicting payload and forbids updates/deletes',async()=>{
    tenant='tenant-a';
    const record=input();
    await app.forgeAudit.append(record);
    await expect(app.forgeAudit.append({...record,workspaceId:'changed'})).rejects.toThrow();
    await expect(app.pool.query('UPDATE forge_audit_events SET workspace_id=$1 WHERE event_id=$2',['changed',record.eventId])).rejects.toThrow();
    await expect(app.pool.query('DELETE FROM forge_audit_events WHERE event_id=$1',[record.eventId])).rejects.toThrow();
  });
  it('rejects secret fields and missing Actor FK',async()=>{
    tenant='tenant-a';
    await expect(app.forgeAudit.append(input({credential:'secret'}))).rejects.toThrow();
    await expect(app.forgeAudit.append(input({actorId:'missing-actor'}))).rejects.toThrow();
  });
});
