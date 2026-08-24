# PhonoPlay analysis service.
#
# A container rather than a serverless function, because this service has
# three requirements serverless platforms do not meet:
#
#   1. ffmpeg and ffprobe as real binaries on PATH (app/audio/ingest.py)
#   2. ~478 MB of scientific Python — llvmlite, scipy, sklearn, numpy, numba,
#      parselmouth — against a 250 MB unzipped limit on Vercel
#   3. a writable disk that survives between requests, for the journey SQLite
#      file. Serverless filesystems are ephemeral, so progress would silently
#      reset and the "come back later" promise would break
#
# Runs as-is on Render, Fly.io, Railway, Cloud Run, or any Docker host.

FROM python:3.12-slim

# ffmpeg carries ffprobe. `--no-install-recommends` keeps the image lean;
# `rm -rf /var/lib/apt/lists/*` in the same layer keeps the index out of it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, from requirements.txt rather than from pyproject.toml.
# `pip install .` would need app/ to already be present for setuptools to
# discover the package, which would put the ~478 MB dependency layer behind
# every source change. This way the slow layer only rebuilds when a
# dependency actually changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Then the package itself, with --no-deps: everything it needs is installed
# above, and re-resolving would undo the caching this ordering buys.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --no-deps .

# Journey progress lives here. Mount a persistent volume at this path — on an
# ephemeral filesystem the database is recreated empty on every restart, which
# loses learner progress without erroring.
ENV JOURNEY_DB_PATH=/data/journey.db
RUN mkdir -p /data
VOLUME ["/data"]

ENV PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8000

EXPOSE 8000

# The lifespan preloads the reference profiles and warms the JIT paths librosa
# compiles on first use, so the container is genuinely ready when it reports
# ready. Give the platform's health check a grace period of ~20s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# Single worker on purpose. Each worker loads its own copy of the reference
# set and its own SQLite connection, and the sqlite3 store is guarded by an
# in-process lock that does not span processes. Scale with instances, not
# workers, or move the store to a shared database first.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
