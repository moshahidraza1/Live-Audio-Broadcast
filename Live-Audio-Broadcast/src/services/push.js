import admin from 'firebase-admin';
import { ApnsClient, Host, Notification, PushType } from 'apns2';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let fcmApp = null;
let apnsClient = null;

function initFcm() {
  if (fcmApp || !env.FCM_SERVICE_ACCOUNT_JSON) return fcmApp;

  try {
    const credentials = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
    fcmApp = admin.initializeApp({ credential: admin.credential.cert(credentials) }, 'fcm');
  } catch (error) {
    logger.error({ err: error }, 'FCM initialization failed');
  }

  return fcmApp;
}

function initApns() {
  if (
    apnsClient ||
    !env.APNS_KEY ||
    !env.APNS_KEY_ID ||
    !env.APNS_TEAM_ID ||
    !env.APNS_VOIP_BUNDLE_ID
  ) {
    return apnsClient;
  }

  const key = env.APNS_KEY.includes('\n') ? env.APNS_KEY.replace(/\\n/g, '\n') : env.APNS_KEY;

  apnsClient = new ApnsClient({
    team: env.APNS_TEAM_ID,
    keyId: env.APNS_KEY_ID,
    signingKey: key,
    defaultTopic: env.APNS_VOIP_BUNDLE_ID,
    host: env.APNS_PRODUCTION ? Host.production : Host.development,
  });

  return apnsClient;
}

export async function sendFcmData({ token, data }) {
  if (!token) {
    return { status: 'failed', provider: 'fcm', error: 'missing_token' };
  }

  const app = initFcm();
  if (!app) {
    return { status: 'failed', provider: 'fcm', error: 'fcm_not_configured' };
  }

  try {
    await app.messaging().send({
      token,
      data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
      android: {
        priority: 'high',
        ttl: 0,
      },
    });
    return { status: 'sent', provider: 'fcm' };
  } catch (error) {
    return { status: 'failed', provider: 'fcm', error: error?.message ?? 'fcm_failed' };
  }
}

export async function sendVoipPush({ token, data }) {
  if (!token) {
    return { status: 'failed', provider: 'apns', error: 'missing_token' };
  }

  const client = initApns();
  if (!client) {
    return { status: 'failed', provider: 'apns', error: 'apns_not_configured' };
  }

  const notification = new Notification(token, {
    type: PushType.voip,
    contentAvailable: true,
    data: data ?? {},
  });

  try {
    await client.send(notification);
    return { status: 'sent', provider: 'apns' };
  } catch (error) {
    return { status: 'failed', provider: 'apns', error: error?.message ?? 'apns_failed' };
  }
}
