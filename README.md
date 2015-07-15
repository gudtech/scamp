SCAMP
=====

Single Connection Asynchronous Multiplexing Protocol

Setup
=============

Setup config and keys for helloworld
-----------------------------------

    sudo mkdir /etc/SCAMP
    sudo chown $USER /etc/SCAMP
    sudo mkdir /var/log/scamp
    sudo chown $USER /var/log/scamp
    sh scripts/init-system-config
    sh scripts/provision-soa-service helloworld main

Node dependencies
-----------------

    npm install

Run Hello World
---------------

    node examples/hello_world_service.js
