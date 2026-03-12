export function generateGitLabCiYaml(): string {
  return `stages:
  - eval

variables:
  NODE_VERSION: "20"

.eval-base:
  image: node:\${NODE_VERSION}
  before_script:
    - npm ci
  cache:
    key: eval-fixtures
    paths:
      - .cursor-plugin-evals/fixtures/
      - node_modules/

eval-static:
  extends: .eval-base
  stage: eval
  script:
    - npx cursor-plugin-evals run --layer static --ci --report json --output eval-static.json
  artifacts:
    when: always
    paths:
      - eval-static.json
    reports:
      junit: eval-static.json

eval-unit:
  extends: .eval-base
  stage: eval
  script:
    - npx cursor-plugin-evals run --layer unit --ci --report json --output eval-unit.json
  artifacts:
    when: always
    paths:
      - eval-unit.json

eval-integration:
  extends: .eval-base
  stage: eval
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2376
  script:
    - docker compose -f docker/docker-compose.yml up -d
    - sleep 10
    - npx cursor-plugin-evals run --layer integration --ci --report json --output eval-integration.json
    - docker compose -f docker/docker-compose.yml down
  artifacts:
    when: always
    paths:
      - eval-integration.json

eval-llm:
  extends: .eval-base
  stage: eval
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2376
  script:
    - docker compose -f docker/docker-compose.yml up -d
    - sleep 10
    - npx cursor-plugin-evals run --layer llm --ci --report json --output eval-llm.json
    - docker compose -f docker/docker-compose.yml down
  artifacts:
    when: always
    paths:
      - eval-llm.json
`;
}
