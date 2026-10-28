const MAX_TRACKED_CLIENTS = 10000;
const stats = new Map();

export const statsTracker = (req, res, next) => {
    const clientId = req.ip || req.socket.remoteAddress || "127.0.0.1";

    res.on("finish", () => {
        if (!stats.has(clientId)) {
            // Guard against unbounded memory consumption
            if (stats.size >= MAX_TRACKED_CLIENTS) {
                const oldestKey = stats.keys().next().value;
                stats.delete(oldestKey);
            }
            stats.set(clientId, { total: 0, allowed: 0, blocked: 0 });
        }

        const clientStats = stats.get(clientId);
        clientStats.total++;

        if (res.statusCode === 429) {
            clientStats.blocked++;
        } else {
            clientStats.allowed++;
        }
    });

    next();
};

export const getStats = () => {
    return Object.fromEntries(stats);
};

export const resetStats = () => {
    stats.clear();
};