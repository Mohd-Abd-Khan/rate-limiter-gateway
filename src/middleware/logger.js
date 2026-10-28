import fs from "fs";
import path from "path";
import winston from "winston";

const logsDir = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  return `[${timestamp}] ${level}: ${message} ${JSON.stringify(meta)}`;
});


export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        logFormat
      )
    }),
    new winston.transports.File({ filename: 'logs/requests.log' }),
    new winston.transports.File({ filename: 'logs/blocked.log', level: 'warn' })
  ]
});