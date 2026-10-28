import express from "express";

const mockApp = express();

mockApp.get("/api/users", (req, res) => {
    res.json({
        status: "ok",
        data: "list of users"
    });
});

mockApp.get("/api/posts", (req, res) => {
    res.json({
        status: "ok",
        data: "list of posts"
    });
});

export { mockApp };