# MIRA Ollama recovery

This package keeps the Ollama process alive, retains the MIRA model in GPU
memory, and checks the local API every minute. After three failed checks it
restarts `ollama.service`, verifies the API, and pre-warms `mira:latest`.

Install on the GPU host after Ollama and the model are present:

```bash
sudo ./ops/ollama/install.sh
```

Change `/etc/mira/ollama-watchdog.env` if the model tag or local port differs.
Inspect recovery activity with:

```bash
systemctl status ollama.service mira-ollama-watchdog.timer
journalctl -u mira-ollama-watchdog.service -n 100 --no-pager
```

The override enables Flash Attention, an 8-bit KV cache, two parallel request
slots, a bounded queue, permanent model residency, and automatic process
restart. If the selected GPU cannot hold two 16k contexts, set
`OLLAMA_NUM_PARALLEL=1` in the systemd override.
