#!/usr/bin/env bash
# Puts the app on DOMAIN (from .env.aws) over HTTPS (plan §8.3 C, D, F). Safe to re-run; each step skips what exists.
#   1. Route 53 hosted zone → prints the 4 nameservers to paste at the registrar   ($0.50/month)
#   2. ACM certificate in us-east-1 for DOMAIN and www.DOMAIN, validated by DNS      (free)
#   3. CloudFront gets the two names + the certificate; A/AAAA alias records to it   (free)
# Step 2 waits until the registrar change has reached DNS; if it has not yet, the script stops and says so.
. "$(dirname "$0")/lib.sh"
load_state
: "${DOMAIN:?set DOMAIN=yourdomain.in in .env.aws}"
: "${DIST_ID:?run infra/aws-up.sh first}"
CF_ZONE=Z2FDTNDATAQYW2 # fixed hosted-zone id for every CloudFront alias

say "1/3 Route 53 hosted zone for $DOMAIN"
ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN." --max-items 1 \
  --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text)
if [ "$ZONE" = "None" ] || [ -z "$ZONE" ]; then
  ZONE=$(aws route53 create-hosted-zone --name "$DOMAIN" --caller-reference "profyn-$(date +%s)" --query HostedZone.Id --output text)
fi
ZONE=${ZONE#/hostedzone/}
save_state HOSTED_ZONE_ID "$ZONE"
NS=$(aws route53 get-hosted-zone --id "$ZONE" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n')
echo "Nameservers to paste at the registrar (all four, without a trailing dot):"
echo "$NS" | sed 's/^/    /'

FIRST_NS=$(echo "$NS" | head -1)
LIVE_NS=$(curl -s "https://dns.google/resolve?name=$DOMAIN&type=NS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).Answer||[]).map(a=>a.data).join(" "))}catch{console.log("")}})')
if ! echo "$LIVE_NS" | grep -qi "${FIRST_NS%.}"; then
  echo
  echo "The registrar still points $DOMAIN elsewhere (now: ${LIVE_NS:-none})."
  echo "Change the nameservers at the registrar to the four above, wait 10-30 min, then run this script again."
  exit 0
fi

say "2/3 ACM certificate (us-east-1) for $DOMAIN and www.$DOMAIN"
CERT=$(aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [ "$CERT" = "None" ] || [ -z "$CERT" ]; then
  CERT=$(aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" --subject-alternative-names "www.$DOMAIN" \
    --validation-method DNS --query CertificateArn --output text)
  sleep 10
fi
save_state CERT_ARN "$CERT"
STATUS=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT" --query Certificate.Status --output text)
if [ "$STATUS" != "ISSUED" ]; then
  aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT" \
    --query 'Certificate.DomainValidationOptions[].ResourceRecord.[Name,Value]' --output text | sort -u |
  while read -r NAME VALUE; do
    [ -z "$NAME" ] && continue
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch \
      "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$NAME\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$VALUE\"}]}}]}" >/dev/null
  done
  echo "Validation records added. Waiting for the certificate (usually 2-10 min)…"
  aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT"
fi

say "3/3 CloudFront serves $DOMAIN and www.$DOMAIN"
TMP=$(mk_tmp)
aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP/cf.json"
ETAG=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP/cf.json','utf8')).ETag)")
node -e "
const fs=require('fs');const c=JSON.parse(fs.readFileSync('$TMP/cf.json','utf8')).DistributionConfig;
c.Aliases={Quantity:2,Items:['$DOMAIN','www.$DOMAIN']};
c.ViewerCertificate={ACMCertificateArn:'$CERT',SSLSupportMethod:'sni-only',MinimumProtocolVersion:'TLSv1.2_2021',CloudFrontDefaultCertificate:false};
fs.writeFileSync('$TMP/new.json',JSON.stringify(c));"
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config "file://$TMP/new.json" >/dev/null
CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)
for NAME in "$DOMAIN" "www.$DOMAIN"; do
  for TYPE in A AAAA; do
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch \
      "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$NAME\",\"Type\":\"$TYPE\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$CF_DOMAIN\",\"EvaluateTargetHealth\":false}}}]}" >/dev/null
  done
done
rm -rf "$TMP"
save_state SITE_URL "https://$DOMAIN"
say "Done. https://$DOMAIN is live once CloudFront finishes deploying (~5 min). Check: BASE_URL=https://$DOMAIN make check"
