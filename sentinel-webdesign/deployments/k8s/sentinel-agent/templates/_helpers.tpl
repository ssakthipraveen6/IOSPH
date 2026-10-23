{{/* Shared env for every SENTINEL agent container. */}}
{{- define "sentinel-agent.env" -}}
- name: SENTINEL_APP_URL
  value: {{ .Values.sentinel.appUrl | quote }}
- name: SENTINEL_GATEWAY_URL
  value: {{ .Values.gateway.endpoint | quote }}
- name: SENTINEL_INGEST_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.name }}
      key: {{ .Values.secrets.ingestKeyKey }}
- name: SENTINEL_GATEWAY_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.name }}
      key: {{ .Values.secrets.gatewayTokenKey }}
- name: SENTINEL_COLLECTOR_CONFIG
  value: /etc/sentinel/collector.yaml
{{- end -}}
