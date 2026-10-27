#!/bin/sh
# Ночной бэкап БД портала. Хранит KEEP_COUNT последних дампов, более старые удаляет.
# Установка на сервере (crontab -e), раз в сутки в тихий час — <мин> <час> подставить свои:
#   <мин> <час> * * * /opt/pmo/deploy/backup.sh >> /var/log/pmo-backup.log 2>&1
set -eu

# Дампы БД содержат все данные портала — пишем их только для владельца.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/opt/pmo/backups}"
KEEP_COUNT="${KEEP_COUNT:-3}"          # держим только N новейших копий — по месту на диске, не по возрасту
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# --clean --if-exists: дамп сам сносит старые объекты при восстановлении,
# поэтому его можно лить в БД, где бэкенд уже создал схему.
docker exec pmo-db pg_dump -U "${POSTGRES_USER:-pmo}" -d "${POSTGRES_DB:-pmo}" --clean --if-exists \
  | gzip > "$BACKUP_DIR/pmo-$STAMP.sql.gz"
chmod 600 "$BACKUP_DIR/pmo-$STAMP.sql.gz"

# бэкап не должен быть пустым
SIZE=$(stat -c%s "$BACKUP_DIR/pmo-$STAMP.sql.gz")
if [ "$SIZE" -lt 10000 ]; then
  echo "ОШИБКА: дамп подозрительно мал ($SIZE байт)" >&2
  exit 1
fi

# Держим только KEEP_COUNT новейших: список по времени (новые сверху), всё после N-й строки — удаляем.
ls -1t "$BACKUP_DIR"/pmo-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_COUNT + 1))" | while IFS= read -r old; do
  rm -f "$old"
done
echo "$(date -Is) бэкап ок: pmo-$STAMP.sql.gz ($SIZE байт), храним $KEEP_COUNT копий"
