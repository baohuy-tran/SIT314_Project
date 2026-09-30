import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

export function createIotPublisher(region, endpoint) {
  if (!endpoint) throw new Error('IOT_DATA_ENDPOINT is required for IoT dispatch');
  const normalizedEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
  return new IoTDataPlaneClient({ region, endpoint: normalizedEndpoint });
}

export function publishIotJson(client, topic, value) {
  return client.send(new PublishCommand({
    topic,
    qos: 1,
    payload: Buffer.from(JSON.stringify(value))
  }));
}
