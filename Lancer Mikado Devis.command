#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/start-shopify-local.mjs
result=$?
if [ "$result" -ne 0 ]; then
  echo 'Le lancement a échoué. Communiquez le message ci-dessus pour corriger le problème.'
  read '?Appuyez sur Entrée pour fermer.'
fi
exit "$result"
