import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs';

export function createSqsClient(region) {
  return new SQSClient({ region });
}

export function sendJson(client, queueUrl, value) {
  return client.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(value)
  }));
}

/**
 * Long-polls a standard SQS queue. A message is deleted only after the handler
 * succeeds; failures remain in the queue and are eventually moved to its DLQ.
 */
export async function consumeQueue({ client, queueUrl, handler, logger, signal }) {
  while (!signal?.aborted) {
    const result = await client.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
      AttributeNames: ['ApproximateReceiveCount']
    }), { abortSignal: signal });

    // Process a received batch sequentially. Standard SQS does not guarantee
    // global ordering, but avoiding concurrent handling prevents messages for
    // the same vehicle racing each other inside one worker.
    for (const message of result.Messages ?? []) {
      try {
        await handler(message.Body);
        await client.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }));
      } catch (error) {
        logger.error({
          error,
          messageId: message.MessageId,
          receiveCount: message.Attributes?.ApproximateReceiveCount
        }, 'SQS message failed; leaving it for retry');
      }
    }
  }
}
