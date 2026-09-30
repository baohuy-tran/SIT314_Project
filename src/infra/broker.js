import fs from 'node:fs';
import mqtt from 'mqtt';
import { config } from '../config.js';

function optionalFile(path) {
  return path ? fs.readFileSync(path) : undefined;
}

export async function connectBroker(clientId) {
  const tls = config.mqttUrl.startsWith('mqtts:');
  const client = mqtt.connect(config.mqttUrl, {
    clientId,
    clean: false,
    reconnectPeriod: 1000,
    ...(tls ? {
      ca: optionalFile(config.mqttCaPath),
      cert: optionalFile(config.mqttCertPath),
      key: optionalFile(config.mqttKeyPath),
      rejectUnauthorized: true
    } : {})
  });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  return client;
}

export function publishJson(client, topic, value, options = {}) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(value), { qos: 1, ...options }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function subscribe(client, topic) {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) => error ? reject(error) : resolve());
  });
}

