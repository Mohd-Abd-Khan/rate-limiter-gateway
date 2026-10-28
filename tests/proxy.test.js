import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

describe("Proxy & Upstream Reliability Tests", () => {
    let mockBackendServer;
    let mockBackendPort;
    let gatewayServer;
    let gatewayPort;

    before(async () => {
        // 1. Start test mock backend
        const mockApp = express();
        mockApp.get("/api/users", (req, res) => {
            res.json({ status: "ok", data: "users", query: req.query });
        });
        mockApp.post("/api/users", (req, res) => {
            res.status(201).json({ status: "created" });
        });

        await new Promise((resolve) => {
            mockBackendServer = mockApp.listen(0, "127.0.0.1", () => {
                mockBackendPort = mockBackendServer.address().port;
                resolve();
            });
        });

        // 2. Start test gateway proxy
        const gatewayApp = express();
        const proxy = createProxyMiddleware({
            target: `http://127.0.0.1:${mockBackendPort}`,
            changeOrigin: true,
            pathRewrite: (path) => `/api${path}`,
            on: {
                error: (err, req, res) => {
                    res.status(502).json({ error: "Bad Gateway" });
                }
            }
        });

        gatewayApp.use("/api", proxy);

        await new Promise((resolve) => {
            gatewayServer = gatewayApp.listen(0, "127.0.0.1", () => {
                gatewayPort = gatewayServer.address().port;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((res) => mockBackendServer.close(res));
        await new Promise((res) => gatewayServer.close(res));
    });

    const request = (path, method = "GET") => {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: "127.0.0.1",
                port: gatewayPort,
                path,
                method
            };
            const req = http.request(options, (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => {
                    let json = null;
                    try { json = JSON.parse(body); } catch {}
                    resolve({ status: res.statusCode, body: json || body });
                });
            });
            req.on("error", reject);
            req.end();
        });
    };

    it("proxies GET /api/users to mock backend with query preservation", async () => {
        const res = await request("/api/users?algo=fixedWindow&test=1");
        assert.equal(res.status, 200);
        assert.equal(res.body.data, "users");
        assert.equal(res.body.query.algo, "fixedWindow");
        assert.equal(res.body.query.test, "1");
    });

    it("preserves HTTP POST method to backend", async () => {
        const res = await request("/api/users", "POST");
        assert.equal(res.status, 201);
        assert.equal(res.body.status, "created");
    });

    it("returns 404 from upstream when route is not found", async () => {
        const res = await request("/api/non-existent-route");
        assert.equal(res.status, 404);
    });
});
