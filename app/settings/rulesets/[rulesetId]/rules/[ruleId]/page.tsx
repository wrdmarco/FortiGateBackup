import { redirect } from "next/navigation";

export default async function LegacyRulePage({params}:{params:Promise<{rulesetId:string;ruleId:string}>}){
  const {rulesetId,ruleId}=await params;
  redirect(`/rulesets/${rulesetId}/rules/${ruleId}`);
}
