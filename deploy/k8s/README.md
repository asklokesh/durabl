# durabl on Kubernetes (config-only)

Minimal **Deployments** for the Restate substrate and the durabl **replay UI**.
All runtime wiring is **environment variables** (ConfigMap); **no secrets** in YAML.

This stack is the **M4 `external` deploy target** (`DURABL_DEPLOY_TARGET=external`).

## M4 deploy-target map

| Target | How it runs | This directory |
|--------|-------------|----------------|
| **local** | Host `restate-server` binary | Not used |
| **docker** | [`docker-compose.yml`](../../docker-compose.yml) profile `docker-demo` | Parity reference |
| **external** | Restate via env (`DURABL_RESTATE_INGRESS/_ADMIN`) | **This k8s stack** |

Gate proof: [`docs/m4-neutrality.md`](../../docs/m4-neutrality.md) (`npm run gate:m4`).

## Resources

- `configmap.yaml` — non-secret env (Restate Service DNS, UI bind)
- `pvc.yaml` — `restate-data`, `durabl-data`
- `restate.yaml` — Restate 1.6.2 Deployment + Service
- `durabl-ui.yaml` — replay UI (`dist/cli.js ui`) on :7878
- `deployment.yaml` — `kubectl apply -f deploy/k8s/deployment.yaml`

SDK service (`dist/service.js`, :9080) is not included; register it with Restate admin after deploy.

## Apply

```bash
docker build -t durabl:0.1.0 .
kubectl apply -f deploy/k8s/deployment.yaml
kubectl port-forward svc/durabl-ui 7878:7878
```
