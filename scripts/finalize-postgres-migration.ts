import { open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const statePath=path.join(process.cwd(),"data","postgres-migration-state.json");
let state:Record<string,unknown>;try{state=JSON.parse(await readFile(statePath,"utf8"));}catch{process.exit(0);}
if(state.phase==="COMPLETE")process.exit(0);
if(state.phase!=="CUTOVER")throw new Error("MIGRATION_FINALIZE_PHASE_INVALID");
const url=process.env.DATABASE_URL??"";if(!/^postgres(?:ql)?:/.test(url))throw new Error("MIGRATION_FINALIZE_DATABASE_INVALID");
const client=new pg.Client({connectionString:url,application_name:"fortibackup-migration-finalizer"});await client.connect();try{const result=await client.query("SELECT oid::text,datname FROM pg_database WHERE datname=current_database()");const identity=`${result.rows[0].oid}:${result.rows[0].datname}`;if(identity!==state.postgresDatabaseId)throw new Error("MIGRATION_FINALIZE_TARGET_MISMATCH");}finally{await client.end();}
for(const phase of ["HEALTH_VERIFIED","COMPLETE"]){state={...state,phase,updatedAt:new Date().toISOString()};const temp=`${statePath}.${process.pid}.tmp`;const handle=await open(temp,"wx",0o600);try{await handle.writeFile(JSON.stringify(state,null,2)+"\n");await handle.sync();}finally{await handle.close();}await rename(temp,statePath);}
process.stdout.write("PostgreSQL-conversie gemarkeerd als COMPLETE.\n");
