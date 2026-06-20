#!/bin/sh
set -eu

template="/usr/share/nginx/html/runtime-config.js.template"
target="/usr/share/nginx/html/runtime-config.js"

if [ -f "$template" ]; then
  if [ -z "${VOICE_ICE_SERVERS:-}" ]; then
    if [ -n "${TURN_USER:-}" ] && [ -n "${TURN_PASSWORD:-}" ] && [ -n "${PUBLIC_APP_URL:-}" ]; then
      turn_host="$(printf '%s' "$PUBLIC_APP_URL" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')"
      VOICE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:'"$turn_host"':3478?transport=udp","turn:'"$turn_host"':3478?transport=tcp"],"username":"'"$TURN_USER"'","credential":"'"$TURN_PASSWORD"'"}]'
    else
      VOICE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]'
    fi
  fi
  export VOICE_ICE_SERVERS
  envsubst '${APP_ENV} ${PUBLIC_APP_URL} ${FIREBASE_API_KEY} ${FIREBASE_AUTH_DOMAIN} ${FIREBASE_PROJECT_ID} ${FIREBASE_STORAGE_BUCKET} ${FIREBASE_MESSAGING_SENDER_ID} ${FIREBASE_APP_ID} ${FIREBASE_MEASUREMENT_ID} ${ADMOB_ANDROID_APP_ID} ${ADMOB_IOS_APP_ID} ${ADMOB_REWARDED_ANDROID_ID} ${ADMOB_REWARDED_IOS_ID} ${VOICE_ICE_SERVERS}' < "$template" > "$target"
fi
