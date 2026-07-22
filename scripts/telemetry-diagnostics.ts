import { readFile } from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const files=[".env.example","setup.sh","update.sh","systemd/fortigate-backup.service","systemd/fortigate-backup-worker.service",".github/workflows/ci.yml"];
const contents=await Promise.all(files.map(async(file)=>[file,await readFile(path.join(root,file),"utf8")] as const));
const failures:string[]=[];
for(const [file,text] of contents){if(!text.includes("NEXT_TELEMETRY_DISABLED")&&file!==".github/workflows/ci.yml")failures.push(`${file}: NEXT_TELEMETRY_DISABLED ontbreekt`);if(!text.includes("CHECKPOINT_DISABLE")&&file!=="systemd/fortigate-backup.service"&&file!=="systemd/fortigate-backup-worker.service")failures.push(`${file}: CHECKPOINT_DISABLE ontbreekt`);}
const packageJson=await readFile(path.join(root,"package.json"),"utf8");
for(const dependency of ["@vercel/analytics","@vercel/speed-insights","@sentry/nextjs","posthog-js","@opentelemetry/exporter"]){if(packageJson.includes(dependency))failures.push(`Verboden telemetrydependency: ${dependency}`);}
const sourceFiles=await import("node:fs/promises").then(async fs=>collect(root,fs));
for(const file of sourceFiles){const text=await readFile(file,"utf8");if(/telemetry\.nextjs\.org|checkpoint\.prisma\.io|OTEL_EXPORTER_OTLP_ENDPOINT/.test(text)&&!file.endsWith("telemetry-diagnostics.ts"))failures.push(`Telemetryendpoint aangetroffen in ${path.relative(root,file)}`);}
if(failures.length){process.stderr.write(failures.join("\n")+"\n");process.exitCode=1;}else process.stdout.write("OK: Next.js telemetry en Prisma checkpoint zijn uitgeschakeld; geen analytics- of telemetry-exporters gevonden.\n");
async function collect(directory:string,fs:typeof import("node:fs/promises")):Promise<string[]>{const entries=await fs.readdir(directory,{withFileTypes:true});const result:string[]=[];for(const entry of entries){if(["node_modules",".next",".git","data","prisma"].includes(entry.name))continue;const full=path.join(directory,entry.name);if(entry.isDirectory())result.push(...await collect(full,fs));else if(/\.(?:ts|tsx|js|mjs|json|yml|yaml|sh|service)$/.test(entry.name))result.push(full);}return result;}
