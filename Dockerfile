# Rems Dl -- headless server image.
# This is the zero-setup option for Linux hosts: everything the app needs
# is inside the image, no Python / WebKitGTK / browser profile setup on the
# host. Native desktop builds (Windows .exe / Linux binary, published with
# GitHub Releases) remain the primary way to run the app as a real desktop
# application; this image is the fallback for servers and minimal distros.
FROM python:3.10-slim

WORKDIR /app

# Headless server mode: no pywebview window, serve on 0.0.0.0:$PORT, and
# never auto-shutdown when a browser tab disconnects (see Rems_Dl.py).
ENV REMS_HEADLESS=1 \
    PORT=5000 \
    PYTHONUNBUFFERED=1

COPY requirements.docker.txt .
RUN pip install --no-cache-dir -r requirements.docker.txt

# Copy everything (app code, web UI, icon/icon.ico + icon/icon.png, databases)
COPY . .

# Expose port 5000 for Flask
EXPOSE 5000

# Persist downloads + user data outside the container:
#   docker run -d -p 5000:5000 \
#     -v "$(pwd)/Rems Dl:/app/Rems Dl" \
#     -v "$(pwd)/database:/app/database" \
#     ghcr.io/remlover-dev/rems-dl:latest
CMD ["python", "Rems_Dl.py"]
