import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
export const AWS = "/Users/kpadonou/.local/b5-aws-cli/aws-cli/aws";
export function plan(root) {
  const m = JSON.parse(readFileSync(join(root,"release-a/release-manifest.json")));
  if(m.target.account!=="570197775998"||m.target.region!=="eu-west-3"||m.target.stage!=="dev"||m.assets.bucket!=="cdk-hnb659fds-assets-570197775998-eu-west-3")throw Error("Wrong target");
  const assets=[...m.assets.executables,m.assets.identityTemplate,m.assets.apiTemplate];
  if(assets.length!==4||new Set(assets.map(x=>x.key)).size!==4)throw Error("Invalid asset count");
  return assets.map(a=>{const file=join(root,"release-a/assets",a.key), digest=createHash("sha256").update(readFileSync(file)).digest();if(digest.toString("hex")!==a.sha256Hex)throw Error("Checksum mismatch");return {file,key:a.key,checksum:digest.toString("base64"),bucket:m.assets.bucket};});
}
export function upload(items, call) {
  for(const item of items){
    const common=["--profile","rem","--region","eu-west-3","--bucket",item.bucket,"--key",item.key,"--expected-bucket-owner","570197775998"];
    let existing;
    try{existing=call(["s3api","head-object",...common,"--checksum-mode","ENABLED","--output","json"]);}catch(error){if(!String(error.stderr??error.message).includes("404"))throw error;}
    if(existing){if(existing.ChecksumSHA256!==item.checksum)throw Error("Existing object conflict");continue;}
    call(["s3api","put-object",...common,"--body",item.file,"--checksum-sha256",item.checksum,"--if-none-match","*","--content-type",item.key.endsWith(".zip")?"application/zip":"application/json"]);
    const verified=call(["s3api","head-object",...common,"--checksum-mode","ENABLED","--output","json"]);
    if(verified.ChecksumSHA256!==item.checksum)throw Error("Published checksum mismatch");
  }
}
