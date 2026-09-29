FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 MODELSCOPE_CACHE=/models
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
COPY services/funasr/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services ./services
EXPOSE 10097
CMD ["uvicorn", "services.funasr.app:app", "--host", "0.0.0.0", "--port", "10097"]
