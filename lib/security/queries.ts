import { BackupStatus, SecurityAnalysisStatus } from "@prisma/client";
import { tenantTransaction } from "@/lib/tenant-db";

export async function tenantSecurityOverview(tenantId:string){return tenantTransaction(tenantId,async(tx)=>{const devices=await tx.fortiGate.findMany({where:{active:true,customer:{tenantId}},select:{id:true,hostname:true,customerId:true,backups:{where:{status:BackupStatus.CHANGED},orderBy:{createdAt:"desc"},take:2,select:{id:true,createdAt:true,configArtifact:{select:{analysis:{select:{id:true,status:true,score:true,criticalCount:true,highCount:true}}}}}}}});const current=devices.map((device)=>({device,backup:device.backups[0]??null,analysis:device.backups[0]?.configArtifact?.analysis??null}));const completed=current.filter((x)=>x.analysis?.status===SecurityAnalysisStatus.COMPLETED&&x.analysis.score!==null);const average=completed.length?Math.round(completed.reduce((sum,x)=>sum+(x.analysis?.score??0),0)/completed.length):null;const previousScores=devices.flatMap((device)=>{const score=device.backups[1]?.configArtifact?.analysis?.score;return typeof score==="number"?[score]:[]});const previousAverage=previousScores.length?Math.round(previousScores.reduce((sum,score)=>sum+score,0)/previousScores.length):null;const trend=average!==null&&previousAverage!==null?average-previousAverage:null;return{average,trend,coverage:{analysed:completed.length,total:devices.length},critical:completed.reduce((sum,x)=>sum+(x.analysis?.criticalCount??0),0),high:completed.reduce((sum,x)=>sum+(x.analysis?.highCount??0),0),belowThreshold:completed.filter((x)=>(x.analysis?.score??100)<70).length,pending:current.filter((x)=>x.analysis?.status===SecurityAnalysisStatus.PENDING||x.analysis?.status===SecurityAnalysisStatus.RUNNING).length,failed:current.filter((x)=>x.analysis?.status===SecurityAnalysisStatus.FAILED||x.analysis?.status===SecurityAnalysisStatus.BLOCKED).length,devices:current};});}

export async function fortigateScoreHistory(tenantId:string,fortigateId:string){return tenantTransaction(tenantId,(tx)=>tx.backup.findMany({where:{tenantId,fortigateId,status:BackupStatus.CHANGED,configArtifact:{analysis:{status:SecurityAnalysisStatus.COMPLETED}}},orderBy:{createdAt:"asc"},select:{id:true,createdAt:true,sha256:true,configArtifact:{select:{analysis:{select:{id:true,score:true,criticalCount:true,highCount:true,mediumCount:true,lowCount:true,parserVersion:true,rulesetVersion:true,completedAt:true}}}}}}));}

export async function customerSecurityOverview(tenantId: string, customerId: string) {
  return tenantTransaction(tenantId, async (tx) => {
    const devices = await tx.fortiGate.findMany({
      where: { active: true, customerId, customer: { tenantId } },
      select: {
        id: true,
        backups: {
          where: { status: BackupStatus.CHANGED },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            configArtifact: {
              select: {
                analysis: {
                  select: {
                    id: true,
                    status: true,
                    score: true,
                    criticalCount: true,
                    highCount: true,
                    completedAt: true
                  }
                }
              }
            }
          }
        }
      }
    });
    const current = devices.map((device) => ({
      fortigateId: device.id,
      backup: device.backups[0] ?? null,
      analysis: device.backups[0]?.configArtifact?.analysis ?? null
    }));
    const completed = current.filter((item) => item.analysis?.status === SecurityAnalysisStatus.COMPLETED && item.analysis.score !== null);
    return {
      average: completed.length ? Math.round(completed.reduce((sum, item) => sum + (item.analysis?.score ?? 0), 0) / completed.length) : null,
      coverage: { analysed: completed.length, total: devices.length },
      critical: completed.reduce((sum, item) => sum + (item.analysis?.criticalCount ?? 0), 0),
      high: completed.reduce((sum, item) => sum + (item.analysis?.highCount ?? 0), 0),
      devices: current
    };
  });
}

export async function fortigateSecuritySnapshot(tenantId: string, fortigateId: string) {
  return tenantTransaction(tenantId, async (tx) => {
    const [latestChanged, history] = await Promise.all([
      tx.backup.findFirst({
        where: { tenantId, fortigateId, status: BackupStatus.CHANGED },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          sha256: true,
          configArtifact: {
            select: {
              analysis: {
                select: {
                  id: true,
                  status: true,
                  score: true,
                  criticalCount: true,
                  highCount: true,
                  mediumCount: true,
                  lowCount: true,
                  completedAt: true,
                  parserVersion: true,
                  rulesetVersion: true
                }
              }
            }
          }
        }
      }),
      tx.backup.findMany({
        where: {
          tenantId,
          fortigateId,
          status: BackupStatus.CHANGED,
          configArtifact: { analysis: { status: SecurityAnalysisStatus.COMPLETED } }
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          configArtifact: { select: { analysis: { select: { id: true, score: true, completedAt: true } } } }
        }
      })
    ]);
    return { latestChanged, history: history.reverse() };
  });
}
