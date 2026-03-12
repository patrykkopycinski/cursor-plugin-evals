## ADDED Requirements

### Requirement: Test Elasticsearch cluster

The Docker infrastructure MUST provision a test Elasticsearch instance on port
9220 with security enabled (`xpack.security.enabled: true`). Authentication MUST
use API key-based auth. The container MUST be ephemeral with no persistent
volumes — all data MUST be discarded when the container stops. The Elasticsearch
version MUST match the version specified in the project configuration or default
to the latest compatible release.

#### Scenario: Elasticsearch accessible on port 9220

- **WHEN** the Docker infrastructure is started
- **THEN** Elasticsearch MUST be reachable at `http://localhost:9220` and respond
  to `GET /` with a valid cluster info JSON containing `version.number`

#### Scenario: Security enabled

- **WHEN** an unauthenticated request is sent to `http://localhost:9220/_cluster/health`
- **THEN** Elasticsearch MUST return HTTP 401 Unauthorized

#### Scenario: API key authentication works

- **WHEN** a request is sent with a valid `Authorization: ApiKey <key>` header
- **THEN** Elasticsearch MUST return HTTP 200 with the requested resource

#### Scenario: Ephemeral data

- **WHEN** the test cluster container is stopped and restarted
- **THEN** all previously created indices and data MUST be gone, and the cluster
  MUST start in a clean state

#### Scenario: No persistent volumes

- **WHEN** the Docker Compose file for the test cluster is inspected
- **THEN** the test Elasticsearch service MUST NOT declare any `volumes` for data
  persistence

---

### Requirement: Test Kibana instance

The Docker infrastructure MUST provision a Kibana instance on port 5620
configured to connect to the test Elasticsearch cluster on port 9220. Kibana MUST
be accessible and fully operational after startup.

#### Scenario: Kibana accessible on port 5620

- **WHEN** the Docker infrastructure is started and all health checks pass
- **THEN** Kibana MUST be reachable at `http://localhost:5620` and respond to
  `GET /api/status` with a valid status JSON

#### Scenario: Kibana connected to test ES

- **WHEN** Kibana's status endpoint is queried
- **THEN** the Elasticsearch connection status MUST show a connection to the
  cluster on port 9220

---

### Requirement: Observability Elasticsearch cluster

The Docker infrastructure MUST provision an observability Elasticsearch instance
on port 9210 with persistent volumes for storing traces and evaluation results.
This cluster MUST retain data across container restarts.

#### Scenario: Obs ES accessible on port 9210

- **WHEN** the Docker infrastructure is started
- **THEN** Elasticsearch MUST be reachable at `http://localhost:9210` and respond
  to `GET /` with valid cluster info

#### Scenario: Persistent data across restarts

- **WHEN** a document is indexed into the obs ES cluster, the container is
  stopped, and the container is restarted
- **THEN** the previously indexed document MUST still be retrievable

#### Scenario: Persistent volumes declared

- **WHEN** the Docker Compose file for the obs cluster is inspected
- **THEN** the obs Elasticsearch service MUST declare named volumes for data
  storage

---

### Requirement: Observability Kibana instance

The Docker infrastructure MUST provision an observability Kibana instance on port
5601 configured to connect to the observability Elasticsearch cluster on port
9210.

#### Scenario: Obs Kibana accessible on port 5601

- **WHEN** the Docker infrastructure is started and all health checks pass
- **THEN** Kibana MUST be reachable at `http://localhost:5601` and respond to
  `GET /api/status` with a valid status JSON

#### Scenario: Obs Kibana connected to obs ES

- **WHEN** the obs Kibana status endpoint is queried
- **THEN** the Elasticsearch connection status MUST show a connection to the
  cluster on port 9210

---

### Requirement: EDOT Collector

The Docker infrastructure MUST provision an EDOT (Elastic Distribution of
OpenTelemetry) Collector that listens on port 4318 for OTLP HTTP traffic. The
collector MUST forward received telemetry data to the observability
Elasticsearch cluster on port 9210.

#### Scenario: OTLP endpoint reachable

- **WHEN** the Docker infrastructure is started
- **THEN** the EDOT Collector MUST accept OTLP HTTP requests at
  `http://localhost:4318/v1/traces`

#### Scenario: Traces forwarded to obs ES

- **WHEN** OTLP trace data is sent to `http://localhost:4318/v1/traces`
- **THEN** the trace data MUST be queryable in the observability Elasticsearch
  cluster on port 9210 within 30 seconds

#### Scenario: Metrics forwarded to obs ES

- **WHEN** OTLP metrics data is sent to `http://localhost:4318/v1/metrics`
- **THEN** the metrics data MUST be queryable in the observability Elasticsearch
  cluster on port 9210

---

### Requirement: Test setup service

The Docker infrastructure MUST include a one-shot setup container that runs
during `docker compose up` and performs initialization tasks. The setup service
MUST set the `kibana_system` password on the test Elasticsearch cluster to enable
Kibana connectivity. The container MUST exit with code 0 after successful setup,
and MUST exit with a non-zero code if setup fails.

#### Scenario: kibana_system password is set

- **WHEN** the setup service completes successfully
- **THEN** the `kibana_system` user MUST be able to authenticate against the test
  Elasticsearch cluster on port 9220

#### Scenario: Setup runs before Kibana starts

- **WHEN** the Docker Compose services are started
- **THEN** the setup service MUST complete before Kibana begins its startup
  sequence (enforced via `depends_on` with a health check or `service_completed_successfully`
  condition)

#### Scenario: Setup container exits after completion

- **WHEN** the setup service finishes its tasks
- **THEN** the container MUST exit with code 0 and MUST NOT remain running

#### Scenario: Setup failure is surfaced

- **WHEN** the setup service cannot reach Elasticsearch or the password change
  API fails
- **THEN** the container MUST exit with a non-zero code and MUST log the error
  message to stdout/stderr

---

### Requirement: Lite mode

The Docker infrastructure MUST provide a `docker-compose.lite.yml` file that
starts only the observability Elasticsearch, observability Kibana, and EDOT
Collector services. This lite mode SHALL be used for mock-mode evaluations that
do not require a live test cluster. The lite compose file MUST be usable
standalone via `docker compose -f docker-compose.lite.yml up`.

#### Scenario: Lite mode starts only obs services

- **WHEN** `docker compose -f docker-compose.lite.yml up` is executed
- **THEN** only the obs-es (port 9210), obs-kibana (port 5601), and
  edot-collector (port 4318) services MUST start

#### Scenario: No test cluster in lite mode

- **WHEN** `docker compose -f docker-compose.lite.yml up` is executed
- **THEN** ports 9220 and 5620 MUST NOT be bound by any container

#### Scenario: Lite mode works for mock evals

- **WHEN** the eval CLI is invoked with `--mock` and the lite infrastructure is
  running
- **THEN** mock-mode evaluations MUST execute successfully, and traces MUST be
  exported to the obs cluster

---

### Requirement: Health checks on all services

Every Docker service MUST define a health check that validates the service is
ready to accept requests. The health check MUST use an appropriate endpoint or
command for each service type. Other services that depend on a health-checked
service MUST use `depends_on` with `condition: service_healthy` to ensure proper
startup ordering.

#### Scenario: Elasticsearch health check

- **WHEN** the test Elasticsearch container starts
- **THEN** the health check MUST query `GET /_cluster/health` (or equivalent)
  and the service MUST report healthy only when the cluster status is `green`
  or `yellow`

#### Scenario: Kibana health check

- **WHEN** the test Kibana container starts
- **THEN** the health check MUST query `GET /api/status` and the service MUST
  report healthy only when Kibana returns a 200 response

#### Scenario: EDOT Collector health check

- **WHEN** the EDOT Collector container starts
- **THEN** the health check MUST verify the collector is ready to accept OTLP
  data

#### Scenario: Dependent service waits for health

- **WHEN** Kibana declares `depends_on: { elasticsearch: { condition: service_healthy } }`
- **THEN** Kibana MUST NOT start until the Elasticsearch health check passes

---

### Requirement: Network isolation

All Docker services MUST be connected to the same Docker network so they can
communicate using service names as hostnames. No services SHALL expose ports to
the host beyond those specified in the requirements (9220, 5620, 9210, 5601,
4318).

#### Scenario: Inter-service communication via service names

- **WHEN** Kibana needs to connect to Elasticsearch
- **THEN** it MUST use the Docker service name (e.g., `http://elasticsearch:9200`)
  as the hostname, resolved via the shared Docker network

#### Scenario: Shared Docker network declared

- **WHEN** the Docker Compose file is inspected
- **THEN** all services MUST be attached to a common named network

#### Scenario: No unexpected host port bindings

- **WHEN** the Docker Compose file is inspected
- **THEN** only ports 9220, 5620, 9210, 5601, and 4318 SHALL be bound to the
  host; no additional ports MUST be exposed
