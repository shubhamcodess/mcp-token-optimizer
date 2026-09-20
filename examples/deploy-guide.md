# Deploying billing-service v2.14.3 to production

We are thrilled to announce that, after extensive and careful consideration by many wonderful teams, the billing-service is ready for its next exciting milestone.

## Step 1: Prepare

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 1, run `make step1` from /srv/billing/deploy/step1.sh with BILLING_REGION=eu-west-1. The expected duration is 10 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c1. If exit code E4001 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step1. Database migration 20260115_add_invoice_index must complete first, with a timeout of 30 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 2: Migrate

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 2, run `make step2` from /srv/billing/deploy/step2.sh with BILLING_REGION=eu-west-2. The expected duration is 20 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c2. If exit code E4002 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step2. Database migration 20260215_add_invoice_index must complete first, with a timeout of 60 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 3: Configure

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 3, run `make step3` from /srv/billing/deploy/step3.sh with BILLING_REGION=eu-west-3. The expected duration is 30 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c3. If exit code E4003 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step3. Database migration 20260315_add_invoice_index must complete first, with a timeout of 90 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 4: Deploy

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 4, run `make step4` from /srv/billing/deploy/step4.sh with BILLING_REGION=eu-west-1. The expected duration is 40 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c4. If exit code E4004 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step4. Database migration 20260415_add_invoice_index must complete first, with a timeout of 120 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 5: Verify

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 5, run `make step5` from /srv/billing/deploy/step5.sh with BILLING_REGION=eu-west-2. The expected duration is 50 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c5. If exit code E4005 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step5. Database migration 20260515_add_invoice_index must complete first, with a timeout of 150 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 6: Rollback

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 6, run `make step6` from /srv/billing/deploy/step6.sh with BILLING_REGION=eu-west-3. The expected duration is 60 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c6. If exit code E4006 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step6. Database migration 20260615_add_invoice_index must complete first, with a timeout of 180 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 7: Monitor

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 7, run `make step7` from /srv/billing/deploy/step7.sh with BILLING_REGION=eu-west-1. The expected duration is 70 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c7. If exit code E4007 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step7. Database migration 20260715_add_invoice_index must complete first, with a timeout of 210 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

## Step 8: Cleanup

It is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.

For step 8, run `make step8` from /srv/billing/deploy/step8.sh with BILLING_REGION=eu-west-2. The expected duration is 80 minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c8. If exit code E4008 appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step8. Database migration 20260815_add_invoice_index must complete first, with a timeout of 240 seconds.

Remember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.

