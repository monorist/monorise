#!/bin/bash

if [[ "$(uname)" == "Darwin" ]]; then
  docker-compose -f packages/core/docker-compose.test.yml up -d
  exit 0
fi

docker compose -f packages/core/docker-compose.test.yml up -d
