# API compatibility harness

The scripts live in the repository so a clean agent can discover and run the byte-compatibility checks.
Golden payloads are tied to one environment's data and therefore stay outside Git.

```powershell
# Capture a trusted baseline into a local, ignored directory
python tools/goldens/capture_api.py capture --base http://localhost:8002 --out tools/goldens/api-v1

# Compare the current service with that baseline
python tools/goldens/capture_api.py compare --base http://localhost:8002 --golden tools/goldens/api-v1

# Exercise reversible create/update/delete flows
python tools/goldens/writeflow.py --base http://localhost:8002
```

For the existing workstation baseline, use `C:\pw-runner\goldens\api-v1`. Never commit generated `.bin` payloads or credentials.
