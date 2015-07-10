# HEADERS

## request\_id

Set to 18 random base64 bytes

## envelope

Envelope format, currently one of "json", "jsonstore", or "extdirect".

## type

"request" or "response"; used only by zmq

## action

Action string in dotted format, like "Constant.Enum.allEnums"

## version

Action version number, positive integer, default 1

## replyAddress

ZMQ only, URL to reply to
