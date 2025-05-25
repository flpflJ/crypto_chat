FROM python:3.13-slim
RUN pip install uvicorn fastapi python-jose pydantic python-multipart uvicorn[standard]
WORKDIR /app
COPY main.py .
EXPOSE 8000/tcp
CMD ["uvicorn", "main:app", "--port", "8000"]