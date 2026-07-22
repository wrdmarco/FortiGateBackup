import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { artifactAbsolutePath, verifyImmutableArtifact } from "@/lib/security/artifact-storage";
import { tenantTransaction } from "@/lib/tenant-db";

export async function GET(_request:Request,{params}:{params:Promise<{reportId:string}>}){const user=await requirePermission("security.reports.download");const tenantId=tenantFilter(user);if(!tenantId)return new NextResponse("Niet gevonden",{status:404});const {reportId}=await params;const report=await tenantTransaction(tenantId,(tx)=>tx.securityAnalysisReport.findFirst({where:{id:reportId,tenantId},include:{analysis:{select:{fortigateId:true,configSha256:true}}}}));if(!report)return new NextResponse("Niet gevonden",{status:404});await verifyImmutableArtifact(report.path,report.sha256,report.filesize);const body=await readFile(artifactAbsolutePath(report.path));await auditLog({action:"security.report.downloaded",tenantId,userId:user.id,entity:"SecurityAnalysisReport",entityId:report.id,metadata:{analysisId:report.analysisId,fortigateId:report.analysis.fortigateId}});return new NextResponse(body,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="fortigate-analyse-${report.analysis.configSha256.slice(0,12)}.pdf"`,"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}});}
