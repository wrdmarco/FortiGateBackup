import { redirect } from "next/navigation";

export default async function LegacyRulesetPage({params}:{params:Promise<{rulesetId:string}>}){
  const {rulesetId}=await params;
  redirect(`/rulesets/${rulesetId}`);
}
