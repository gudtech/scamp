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

    node js/script/cache-manager.js
    node examples/hello_world_service.js
    node examples/hello_world_service.js

Using Vagrant with VirtualBox Provider
--------------------------------------

Prerequisites:

  * [vagrant](https://www.vagrantup.com/)
  * [virtualbox](https://www.virtualbox.org/wiki/Downloads)

Note: [brew cask](https://github.com/caskroom/homebrew-cask) is a good option for managing the installation of Vagrant and VirtualBox.

Initializing the VM:

    vagrant init chef/centos-6.6; vagrant up --provider virtualbox

Note: VMWare Fusion is a fully supported provider for Vagrant. Please feel free to provide documentation for its setup.

The vagrant image is provisioned through a shell script. An inline bash script found in this project's `Vagrantfile`. The script will install basic dependencies for running scamp. To rerun the provisioning script on a running vagrant instance: `vagrant provision`.

Logging in to the VM:

    vagrant ssh

The `vagrant` user has sudo.

Note: You will find this code synced to `/vagrant`.