#!/bin/bash
repository_name=${GITHUB_REPOSITORY#*/}
if [[ $repository_name == *.github.io ]]; then
  echo "Name ends with github.io"
else
  echo "Name does not end with github.io, not generating pages"
  exit
fi

npm install
npm run build

set -e
cp -r site/build docs
pushd docs
ls -la
git add *
git commit -am "Updated $(date +'%Y-%m-%d')"
git push
popd
