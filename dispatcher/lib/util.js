function safeStr(o) {
    try {
        return String(o);
    } catch (e) {
        return "[object Object]";
    }
}

exports.safeStr = safeStr;
