import asyncio
import os
import uvicorn

from webhook_server import app  # FastAPI app
import worker  # worker module with loop()

PORT = int(os.getenv("AGENT_ZERO_PORT", "4000"))

async def start_server():
    config = uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()

async def main():
    server_task = asyncio.create_task(start_server())
    worker_task = asyncio.create_task(worker.loop())
    done, pending = await asyncio.wait(
        {server_task, worker_task}, return_when=asyncio.FIRST_EXCEPTION
    )
    for t in pending:
        t.cancel()
    for t in done:
        if t.exception():
            raise t.exception()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Shutdown requested.")
