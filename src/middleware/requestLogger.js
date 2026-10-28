import { logger } from "./logger.js";

export const requestLogger = (req, res, next) => {
    const startTime = Date.now();

    res.on("finish", ()=> {
        const responseTime = Date.now() - startTime;
        const clientId = req.ip;
        const metaData = {
            method : req.method,
            url : req.originalUrl,
            clientId,
            status : res.statusCode,
            responseTime: `${responseTime}ms`
        };

        if(res.statusCode === 429){
            logger.warn("Request Blocked", metaData);
        }else if(res.statusCode >= 500){
            logger.error("Server Error", metaData);
        }else{
            logger.info("Request Completed", metaData);
        }
    })

    next();
}