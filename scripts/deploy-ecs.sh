#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECS_CLUSTER="${ECS_CLUSTER:-ride-matching-cluster}"
ECR_REPOSITORY="${ECR_REPOSITORY:-ride-matching}"
ECS_SERVICES="${ECS_SERVICES:-api-service,matching-service,trip-service}"
IMAGE_TAG="${IMAGE_TAG:-eta-$(date -u +%Y%m%d-%H%M%S)}"
TARGET_PLATFORM="${TARGET_PLATFORM:-}"

for command_name in aws docker jq; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$AWS_REGION")"
ECR_HOST="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${ECR_HOST}/${ECR_REPOSITORY}:${IMAGE_TAG}"

aws ecr describe-repositories \
  --repository-names "$ECR_REPOSITORY" \
  --region "$AWS_REGION" >/dev/null

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST"

IFS=',' read -r -a service_names <<< "$ECS_SERVICES"
source_service="${service_names[0]//[[:space:]]/}"
source_task_definition="$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$source_service" \
  --region "$AWS_REGION" \
  --query 'services[0].taskDefinition' \
  --output text)"
BASE_IMAGE="${BASE_IMAGE:-$(aws ecs describe-task-definition \
  --task-definition "$source_task_definition" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.containerDefinitions[0].image' \
  --output text)}"
if [[ -z "$TARGET_PLATFORM" ]]; then
  cpu_architecture="$(aws ecs describe-task-definition \
    --task-definition "$source_task_definition" \
    --region "$AWS_REGION" \
    --query 'taskDefinition.runtimePlatform.cpuArchitecture' \
    --output text)"
  case "$cpu_architecture" in
    ARM64) TARGET_PLATFORM="linux/arm64" ;;
    X86_64) TARGET_PLATFORM="linux/amd64" ;;
    *)
      echo "Unsupported or missing ECS CPU architecture: $cpu_architecture" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$BASE_IMAGE" || "$BASE_IMAGE" == "None" ]]; then
  echo "Could not resolve the currently deployed base image" >&2
  exit 1
fi

echo "Building and pushing ${IMAGE_URI} for ${TARGET_PLATFORM}"
echo "Reusing dependencies from ${BASE_IMAGE}"
docker buildx build \
  --platform "$TARGET_PLATFORM" \
  --file Dockerfile.release \
  --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
  --tag "$IMAGE_URI" \
  --push .

DEPLOY_TMP="$(mktemp -d)"
trap 'rm -rf "$DEPLOY_TMP"' EXIT

for service_name in "${service_names[@]}"; do
  service_name="${service_name//[[:space:]]/}"
  current_task_definition="$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$service_name" \
    --region "$AWS_REGION" \
    --query 'services[0].taskDefinition' \
    --output text)"

  if [[ -z "$current_task_definition" || "$current_task_definition" == "None" ]]; then
    echo "Could not resolve task definition for service: $service_name" >&2
    exit 1
  fi

  source_json="${DEPLOY_TMP}/${service_name}-source.json"
  register_json="${DEPLOY_TMP}/${service_name}-register.json"
  aws ecs describe-task-definition \
    --task-definition "$current_task_definition" \
    --region "$AWS_REGION" \
    --query taskDefinition > "$source_json"

  jq --arg image "$IMAGE_URI" '
    del(
      .taskDefinitionArn,
      .revision,
      .status,
      .requiresAttributes,
      .compatibilities,
      .registeredAt,
      .registeredBy
    )
    | .containerDefinitions |= map(.image = $image)
  ' "$source_json" > "$register_json"

  new_task_definition="$(aws ecs register-task-definition \
    --cli-input-json "file://${register_json}" \
    --region "$AWS_REGION" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"

  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$service_name" \
    --task-definition "$new_task_definition" \
    --region "$AWS_REGION" \
    --query 'service.{service:serviceName,taskDefinition:taskDefinition}'

  echo "Waiting for ${service_name} to become stable"
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$service_name" \
    --region "$AWS_REGION"
done

echo "Deployment complete: ${IMAGE_URI}"
