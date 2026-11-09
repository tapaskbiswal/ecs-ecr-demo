# Push a Docker Image to Amazon ECR

Repository: `tapasawsbatch18` | Region: `us-west-1` (N. California)

Run all commands in PowerShell. Docker Desktop must be running.

## 1. Prerequisites

```powershell
aws --version
```
Checks the AWS CLI is installed.

```powershell
aws configure
```
Saves your credentials. Enter Access Key ID, Secret Access Key, region `us-west-1` and output format `json`.
If you use temporary credentials, also run:
```powershell
aws configure set aws_session_token <TOKEN>
```

```powershell
aws sts get-caller-identity
```
Verifies the credentials work and shows your account ID.

## 2. Create the ECR repository (one time)

```powershell
aws ecr create-repository --repository-name tapasawsbatch18 --region us-west-1
```
Creates a private repository. The output contains `repositoryUri`.

Optional: scan images on push.
```powershell
aws ecr put-image-scanning-configuration --repository-name tapasawsbatch18 --image-scanning-configuration scanOnPush=true --region us-west-1
```

Check it exists:
```powershell
aws ecr describe-repositories --repository-names tapasawsbatch18 --region us-west-1
```

## 3. Build and test the image locally

```powershell
cd C:\HeroVired\HeroVired_GitProjects\ECS
```
Moves into the project folder that holds the Dockerfile.

```powershell
docker build -t tapasawsbatch18 .
```
Builds the image from the Dockerfile and names it `tapasawsbatch18`.

```powershell
docker run -d -p 3000:3000 --name tapas-app tapasawsbatch18
```
Starts a container in the background and maps port 3000 on your machine to port 3000 in the container.

```powershell
curl http://localhost:3000
curl http://localhost:3000/students
```
Tests the app. It should return JSON.

```powershell
docker stop tapas-app
docker rm tapas-app
```
Stops and deletes the test container.

## 4. Push to ECR

```powershell
$acc = aws sts get-caller-identity --query Account --output text
```
Stores your AWS account ID in a variable.

```powershell
aws ecr get-login-password --region us-west-1 | docker login --username AWS --password-stdin "$acc.dkr.ecr.us-west-1.amazonaws.com"
```
Gets a temporary password (valid 12 hours) and logs Docker in to ECR. Expect `Login Succeeded`. `AWS` is a fixed username.

```powershell
docker tag tapasawsbatch18:latest "$acc.dkr.ecr.us-west-1.amazonaws.com/tapasawsbatch18:latest"
```
Adds the ECR repository address to the image name so Docker knows where to push.

```powershell
docker push "$acc.dkr.ecr.us-west-1.amazonaws.com/tapasawsbatch18:latest"
```
Uploads the image to ECR.

## 5. Verify

```powershell
aws ecr list-images --repository-name tapasawsbatch18 --region us-west-1
```
Lists the images. You should see the `latest` tag.

In the console: AWS Console > ECR > Private registry > Repositories > `tapasawsbatch18` > **Images** tab. Make sure the region is N. California and refresh.

## 6. Deploy the image to ECS (Fargate)

ECS concepts:
- Task definition: versioned config describing how containers run.
- Container definition: config of one container inside a task definition.
- Task: a running instance of a task definition.
- Service: keeps the desired number of tasks running and manages updates.
- Capacity provider: the compute capacity (Fargate or EC2).
- Repository: ECR, where the image is stored.

Files used (already in this folder): `taskdef.json` (task definition template with an `ACCOUNT_ID` placeholder) and `trust.json` (lets ECS tasks assume a role).

### 6.1 Create the task execution role (one time)
```powershell
aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document file://trust.json
```
Creates the role ECS uses to pull the image from ECR and write logs. If it already exists, you get an error you can ignore.

```powershell
aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```
Gives the role the AWS-managed permissions for ECR pulls and CloudWatch logs.

### 6.2 Create the cluster and log group
```powershell
aws ecs create-cluster --cluster-name tapas-cluster --region us-west-1
```
Creates the ECS cluster, the logical group your tasks run in.

```powershell
aws logs create-log-group --log-group-name /ecs/tapasawsbatch18 --region us-west-1
```
Creates the CloudWatch log group where container logs go.

### 6.3 Register the task definition
```powershell
$acc = aws sts get-caller-identity --query Account --output text
(Get-Content taskdef.json) -replace 'ACCOUNT_ID', $acc | Set-Content taskdef.rendered.json
```
Copies the template and fills in your account ID. The rendered file is git-ignored, so your account ID is not committed.

```powershell
aws ecs register-task-definition --cli-input-json file://taskdef.rendered.json --region us-west-1
```
Registers a new revision of the task definition (image, CPU, memory, port, logs).

### 6.4 Prepare networking (default VPC)
```powershell
$vpc = aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text --region us-west-1
$subnets = (aws ec2 describe-subnets --filters Name=vpc-id,Values=$vpc --query "Subnets[*].SubnetId" --output text --region us-west-1) -split "\s+" -join ","
```
Finds the default VPC and its subnets (joined with commas).

```powershell
$sg = aws ec2 create-security-group --group-name tapas-ecs-sg --description "ECS app" --vpc-id $vpc --query GroupId --output text --region us-west-1
aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port 3000 --cidr 0.0.0.0/0 --region us-west-1
```
Creates a security group and opens port 3000 so you can reach the app. For anything beyond a demo, restrict the CIDR to your own IP.

### 6.5 Create the service
```powershell
aws ecs create-service --cluster tapas-cluster --service-name tapas-service --task-definition tapasawsbatch18 --desired-count 1 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" --region us-west-1
```
Starts 1 Fargate task and keeps it running. `assignPublicIp=ENABLED` gives it a public IP, which it also needs to pull from ECR in a default VPC.

### 6.6 Check status and test
```powershell
aws ecs describe-services --cluster tapas-cluster --services tapas-service --query "services[0].{status:status,running:runningCount,desired:desiredCount}" --region us-west-1
```
Wait until `running` is 1.

```powershell
$task = aws ecs list-tasks --cluster tapas-cluster --service-name tapas-service --query "taskArns[0]" --output text --region us-west-1
$eni = aws ecs describe-tasks --cluster tapas-cluster --tasks $task --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" --output text --region us-west-1
$ip = aws ec2 describe-network-interfaces --network-interface-ids $eni --query "NetworkInterfaces[0].Association.PublicIp" --output text --region us-west-1
curl "http://${ip}:3000"
curl "http://${ip}:3000/students"
```
Looks up the task's public IP and calls the app. You should get JSON back.

Console: ECS > Clusters > `tapas-cluster` > Services > `tapas-service` > Tasks. Check the region is N. California.

### 6.7 Deploy a new version
```powershell
docker build -t tapasawsbatch18 .
docker tag tapasawsbatch18:latest "$acc.dkr.ecr.us-west-1.amazonaws.com/tapasawsbatch18:latest"
docker push "$acc.dkr.ecr.us-west-1.amazonaws.com/tapasawsbatch18:latest"
aws ecs update-service --cluster tapas-cluster --service tapas-service --force-new-deployment --region us-west-1
```
Rebuilds and pushes the image, then makes the service start new tasks that pull it. The public IP changes after a deployment.

## 7. Cleanup (optional)

Delete ECS resources first to stop charges:
```powershell
aws ecs update-service --cluster tapas-cluster --service tapas-service --desired-count 0 --region us-west-1
aws ecs delete-service --cluster tapas-cluster --service tapas-service --force --region us-west-1
aws ecs delete-cluster --cluster tapas-cluster --region us-west-1
```
Scales the service to zero, deletes it, then deletes the cluster.

```powershell
aws ecr delete-repository --repository-name tapasawsbatch18 --region us-west-1 --force
```
Deletes the ECR repository and all its images.

## Issues I Faced and Fixes

| # | Issue | Cause | Fix |
|---|-------|-------|-----|
| 1 | `aws configure` offered `ap-south-1` as the default region | A region was already saved on my machine | The repository was in `us-west-1`, so I used `us-west-1` in every command. The region must match everywhere. |
| 2 | Repository not found or image not visible in the console | The console region differed from the CLI region | Set the console region (top right) to N. California (`us-west-1`), then open the repository's **Images** tab and refresh. |
| 3 | Copied `<ACCOUNT_ID>` literally | It is a placeholder, not a real value | Replace it, without the angle brackets, with the 12-digit account ID, or use `$acc` as in section 4. |
| 4 | `docker login` username | I wasn't sure what to enter | The username is always the fixed text `AWS`. The password is generated by `aws ecr get-login-password`, so I never type it. |
| 5 | Timestamps in the console differ from my clock | The console shows UTC+05:30 local time | Not a problem. It is only a display difference. |
| 6 | `list-images` showed extra untagged digests | Multi-platform builds create extra manifests | Normal. Only the `latest` tag matters. |
| 7 | ECS task stops with `CannotPullContainerError` | No public IP or missing execution role | Use `assignPublicIp=ENABLED` and the `ecsTaskExecutionRole` from 6.1. |
| 8 | App not reachable on the task IP | Security group doesn't allow port 3000 | Add the inbound rule from 6.4. |

## Security Notes (safe for GitHub)

This file contains no real secrets. Sensitive values are masked:

- Access Key ID / Secret Access Key: never written here. Entered only in `aws configure`.
- Session token: `<TOKEN>` placeholder.
- AWS account ID: masked as `$acc` (read at runtime), or `<ACCOUNT_ID>`.
- Docker password: generated by AWS, never stored.

Never commit `~\.aws\credentials`, `.env` files or any keys.

## Troubleshooting

- Image not visible in the console: check the region and account, open the repository and its Images tab, then refresh.
- "repository does not exist": the region in the command differs from the repository's region.
- Login expired: repeat the `docker login` step.
- Never share or commit your access keys.
