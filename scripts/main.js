"use strict";

// Mindustry UUID Identity Switcher
// Hidden client-side script mod. Non-Steam only.

const Uis = {};

Uis.prefix = "uuidIdentitySwitcher.";
Uis.configKey = Uis.prefix + "config";
Uis.version = 2;
Uis.pendingServerKey = null;
Uis.pendingServerAt = 0;
Uis.lastActualServerKey = null;
Uis.lastAppliedIdentityId = null;
Uis.connectHookInstalled = false;
Uis.connectHookDisabled = false;
Uis.connectHookRetryAt = 0;
Uis.hookWarned = {};
Uis.categoryInstalled = false;
Uis.categoryRetryAt = 0;
Uis.bootstrapRetryAt = 0;
Uis.bootstrapStopAt = 0;
Uis.managerTable = null;

Uis.JString = java.lang.String;
Uis.ByteType = java.lang.Byte.TYPE;
Uis.ByteArray = java.lang.reflect.Array;
Uis.Base64Coder = Packages.arc.util.serialization.Base64Coder;
Uis.CRC32 = java.util.zip.CRC32;
Uis.ByteBuffer = java.nio.ByteBuffer;
Uis.InetAddress = java.net.InetAddress;
Uis.System = java.lang.System;
Uis.MessageDigest = java.security.MessageDigest;
Uis.StandardCharsets = java.nio.charset.StandardCharsets;
Uis.JavaRandom = java.util.Random;
Uis.searchRandom = new Uis.JavaRandom();
Uis.Class = java.lang.Class;
Uis.ConnectClass = Uis.Class.forName("mindustry.net.Packets$Connect");
Uis.ClientServerConnectEventClass = Uis.Class.forName("mindustry.game.EventType$ClientServerConnectEvent");
Uis.ClientLoadEventClass = Uis.Class.forName("mindustry.game.EventType$ClientLoadEvent");
Uis.bootstrapStopAt = Uis.System.currentTimeMillis() + 90000;

Uis.copyObject = function(obj){
    const out = {};
    for(let k in obj) out[k] = obj[k];
    return out;
};

Uis.defaultConfig = function(){
    return {
        version: Uis.version,
        autoCreate: false,
        defaultId: null,
        identities: [],
        serverMap: {},
        // Original vanilla identity captured before this mod writes settings.
        // uuid is global; usid is per normalized server key.
        vanilla: {uuid: null, usids: {}},
        lastApplied: null,
        debugLogs: false
    };
};

Uis.ensureConfig = function(cfg){
    if(cfg == null || typeof(cfg) !== "object") cfg = Uis.defaultConfig();
    if(cfg.version == null) cfg.version = Uis.version;
    if(cfg.autoCreate == null) cfg.autoCreate = false;
    if(cfg.defaultId === undefined) cfg.defaultId = null;
    if(!(cfg.identities instanceof Array)) cfg.identities = [];
    if(cfg.serverMap == null || typeof(cfg.serverMap) !== "object") cfg.serverMap = {};
    if(cfg.vanilla == null || typeof(cfg.vanilla) !== "object") cfg.vanilla = {uuid: null, usids: {}};
    if(cfg.vanilla.usids == null || typeof(cfg.vanilla.usids) !== "object") cfg.vanilla.usids = {};
    if(cfg.debugLogs == null) cfg.debugLogs = false;
    if(cfg.lastApplied === undefined) cfg.lastApplied = null;

    for(let i = 0; i < cfg.identities.length; i++){
        const it = cfg.identities[i];
        if(!it.id) it.id = Uis.newId();
        if(!it.name) it.name = "Identity " + (i + 1);
        if(!it.uuid) it.uuid = Uis.randomBase64(8);
        if(!it.usid) it.usid = Uis.randomBase64(8);
        if(!(it.servers instanceof Array)) it.servers = [];
    }
    return cfg;
};

Uis.loadConfig = function(){
    let text = "";
    try{
        text = String(Core.settings.getString(Uis.configKey, ""));
    }catch(e){
        text = "";
    }

    if(text.trim().length === 0) return Uis.defaultConfig();

    try{
        return Uis.ensureConfig(JSON.parse(text));
    }catch(e){
        Log.err("[UUID Identity Switcher] Failed to parse config. A fresh config is used for this session.", e);
        return Uis.defaultConfig();
    }
};

Uis.saveConfig = function(cfg){
    cfg = Uis.ensureConfig(cfg);
    Core.settings.put(Uis.configKey, JSON.stringify(cfg));
    Core.settings.forceSave();
};

Uis.getSettingString = function(key, def){
    try{
        const value = Core.settings.getString(key, def);
        return value == null ? null : String(value);
    }catch(e){
        return def == null ? null : String(def);
    }
};

Uis.putSettingString = function(key, value){
    if(value == null){
        try{
            Core.settings.remove(key);
        }catch(e){
            // Old Arc settings implementations all have remove(), but keep this
            // defensive so identity switching never aborts because of cleanup.
        }
    }else{
        Core.settings.put(key, String(value));
    }
};

Uis.hasOwn = function(obj, key){
    return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
};

Uis.isKnownManagedUuid = function(cfg, value){
    value = String(value == null ? "" : value);
    if(value.length === 0) return false;
    if(cfg.lastApplied != null && String(cfg.lastApplied.uuid || "") === value) return true;
    for(let i = 0; i < cfg.identities.length; i++){
        if(String(cfg.identities[i].uuid || "") === value) return true;
    }
    return false;
};

Uis.isKnownManagedUsid = function(cfg, value){
    value = String(value == null ? "" : value);
    if(value.length === 0) return false;
    if(cfg.lastApplied != null && String(cfg.lastApplied.usid || "") === value) return true;
    for(let i = 0; i < cfg.identities.length; i++){
        if(String(cfg.identities[i].usid || "") === value) return true;
    }
    return false;
};

Uis.captureVanillaUuid = function(cfg){
    cfg = Uis.ensureConfig(cfg);
    if(cfg.vanilla.uuid == null || String(cfg.vanilla.uuid).length === 0){
        const cur = Uis.getSettingString("uuid", "");
        // New configs have no identities; legacy configs from versions before
        // vanilla backup had no lastApplied marker. In both cases, preserving
        // the current value is safer than leaving the original slot empty.
        if(cur != null && cur.length > 0 && (cfg.lastApplied == null || !Uis.isKnownManagedUuid(cfg, cur))){
            cfg.vanilla.uuid = cur;
        }
    }
};

Uis.rememberVanillaForKeys = function(cfg, keys){
    cfg = Uis.ensureConfig(cfg);
    Uis.captureVanillaUuid(cfg);

    for(let i = 0; i < keys.length; i++){
        const key = Uis.normalizeServerKey(keys[i]);
        if(key.length === 0) continue;
        if(Uis.hasOwn(cfg.vanilla.usids, key)) continue;

        const cur = Uis.getSettingString("usid-" + key, null);
        if(cur != null && cur.length > 0 && (cfg.lastApplied == null || !Uis.isKnownManagedUsid(cfg, cur))){
            cfg.vanilla.usids[key] = cur;
        }
    }
};

Uis.initializeConfig = function(){
    const text = Uis.getSettingString(Uis.configKey, "");
    if(text != null && String(text).trim().length > 0) return;

    const cfg = Uis.defaultConfig();
    Uis.captureVanillaUuid(cfg);
    Uis.saveConfig(cfg);
};

Uis.debug = function(message){
    let enabled = false;
    try{
        enabled = !!Uis.loadConfig().debugLogs;
    }catch(e){
        enabled = false;
    }
    if(enabled){
        Log.info(String(message));
    }else{
        try{
            Log.debug(String(message));
        }catch(e2){
        }
    }
};

Uis.warnOnce = function(key, message){
    if(Uis.hookWarned[key]) return;
    Uis.hookWarned[key] = true;
    Log.warn(String(message));
};

Uis.currentModName = function(){
    try{
        if(typeof modName !== "undefined") return String(modName);
    }catch(e){
    }
    return "uuid-identity-switcher";
};

Uis.hideCurrentModFromServerList = function(){
    // Android compatibility package is intentionally visible in metadata so
    // MindustryX/Android can't accidentally skip hidden script mods. Once the
    // script is actually running, hide it from mods.getModStrings() again so
    // normal servers do not reject the extra client mod.
    try{
        const name = Uis.currentModName();
        if(name === "uuid-identity-switcher-android"){
            const loaded = Vars.mods.locateMod(name);
            if(loaded != null && loaded.meta != null){
                loaded.meta.hidden = true;
                Uis.debug("[UUID Identity Switcher] Android package loaded; hidden from server mod list.");
            }
        }
    }catch(e){
        Uis.warnOnce("hide-self-failed", "[UUID Identity Switcher] Failed to hide Android compatibility package from server mod list: " + String(e));
    }
};

Uis.newId = function(){
    return "id-" + String(Uis.System.currentTimeMillis()) + "-" + String(Mathf.random(999999));
};

Uis.newBytes = function(len){
    return Uis.ByteArray.newInstance(Uis.ByteType, len);
};

Uis.copyBytes = function(src, off, len){
    const out = Uis.newBytes(len);
    for(let i = 0; i < len; i++){
        out[i] = src[off + i];
    }
    return out;
};

Uis.base64 = function(bytes){
    return String(new Uis.JString(Uis.Base64Coder.encode(bytes)));
};

Uis.randomBase64 = function(bytes){
    const out = Uis.newBytes(bytes);
    new Rand().nextBytes(out);
    return Uis.base64(out);
};

Uis.repeatChar = function(ch, count){
    let out = "";
    for(let i = 0; i < count; i++) out += ch;
    return out;
};

Uis.compactBase64 = function(value){
    return String(value == null ? "" : value).trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
};

Uis.shortCodeOf = function(value){
    let s = Uis.compactBase64(value);
    while(s.length > 0 && s.charAt(s.length - 1) === "="){
        s = s.substring(0, s.length - 1);
    }
    // Treat only short human-facing server IDs as short codes. Full 8-byte
    // client UUIDs are normally 11 chars + '=' and must not be mistaken here.
    if(s.length >= 1 && s.length <= 6 && /^[A-Za-z0-9+/]+$/.test(s)){
        return s;
    }
    return null;
};

Uis.shortIdFromString = function(value){
    return Uis.shortIdFromStringDigest(value, Uis.MessageDigest.getInstance("md5"));
};

Uis.shortIdFromStringDigest = function(value, digest){
    const bytes = new Uis.JString(String(value == null ? "" : value)).getBytes(Uis.StandardCharsets.UTF_8);
    // Equivalent to ScriptAgent4MindustryExt:
    // md5Digest.update(md5Digest.digest(bs)); md5Digest.digest(bs)
    digest.reset();
    const first = digest.digest(bytes);
    digest.update(first);
    const out = digest.digest(bytes);

    const enc = Uis.Base64Coder.encode(out);
    let result = "";
    for(let i = 0; i < 3; i++){
        let ch = String.fromCharCode(enc[i]);
        if(ch === "k") ch = "K";
        else if(ch === "S") ch = "s";
        else if(ch === "l") ch = "L";
        else if(ch === "+") ch = "A";
        else if(ch === "/") ch = "B";
        result += ch;
    }
    return result;
};

Uis.scriptAgentShortIdFromClientUuid = function(clientUuid){
    return Uis.shortIdFromString(Uis.serverUuidFromClient(clientUuid));
};

Uis.randomUuidForShortId = function(target){
    target = Uis.shortCodeOf(target);
    if(target == null || target.length !== 3){
        throw "ScriptAgent 的 shortID 必须正好是 3 位，例如 6s2、5pa、Ohk。";
    }

    const start = Uis.System.currentTimeMillis();
    let attempts = 0;
    let candidate = null;
    const digest = Uis.MessageDigest.getInstance("md5");

    // Expected work: 64^3 = 262144 attempts. This may take a few seconds in
    // Rhino, so keep a generous budget and show attempts in errors.
    while(Uis.System.currentTimeMillis() - start < 20000){
        const bytes = Uis.newBytes(8);
        Uis.searchRandom.nextBytes(bytes);
        candidate = Uis.base64(bytes);
        attempts++;
        if(Uis.shortIdFromStringDigest(Uis.serverUuidFromClient(candidate), digest) === target){
            Log.info("[UUID Identity Switcher] Found UUID '@' for ScriptAgent shortID '@' in @ attempts.", candidate, target, attempts);
            return candidate;
        }
    }

    throw "20 秒内没有搜索到 shortID=" + target + " 的 UUID，请再点一次转换。已尝试 " + attempts + " 次。";
};

Uis.clientUuidFromPrefix = function(value){
    let s = Uis.compactBase64(value);
    while(s.length > 0 && s.charAt(s.length - 1) === "="){
        s = s.substring(0, s.length - 1);
    }

    if(s.length === 0) throw "UUID 短码不能为空。";
    if(s.length > 11) throw "UUID 短码最多 11 位；完整客户端 UUID 请使用 8 字节 Base64。";
    if(!/^[A-Za-z0-9+/]+$/.test(s)){
        throw "UUID 短码只能包含 Base64 字符：A-Z a-z 0-9 + /，也兼容 - _。";
    }

    // 8 raw bytes encode to 11 non-padding Base64 chars + '='.
    // A short code like "6s2" is the short server UID/prefix. Generate a
    // random full client UUID that keeps that server-visible prefix instead
    // of zero-padding the rest.
    const randomFull = Uis.randomBase64(8);
    const randomNoPad = randomFull.substring(0, randomFull.length - 1);
    const full = s + randomNoPad.substring(s.length, 11) + "=";
    const bytes = Uis.Base64Coder.decode(full);
    if(bytes.length !== 8){
        throw "短码转换失败，解码长度不是 8 字节：" + bytes.length;
    }
    return Uis.base64(bytes);
};

Uis.normalizeClientUuid = function(value){
    const s = Uis.compactBase64(value);
    if(s.length === 0) throw "UUID 不能为空。";

    let decodeError = null;
    let bytes;
    try{
        bytes = Uis.Base64Coder.decode(s);
    }catch(e){
        decodeError = e;
    }

    if(bytes != null){
        if(bytes.length === 8){
            return Uis.base64(bytes);
        }

        if(bytes.length === 16){
            // Server-side displayed UUID is base64(raw 8 bytes + CRC64-ish long field).
            // The client setting only stores the first raw 8 bytes.
            return Uis.base64(Uis.copyBytes(bytes, 0, 8));
        }
    }

    try{
        const shortCode = Uis.shortCodeOf(s);
        return shortCode != null && shortCode.length === 3 ? Uis.randomUuidForShortId(shortCode) : Uis.clientUuidFromPrefix(s);
    }catch(prefixError){
        if(decodeError != null){
            throw "UUID 不是合法 Base64，也无法作为短码转换：" + String(prefixError);
        }
        throw "UUID 必须是 8 字节客户端 UUID、16 字节服务端 UUID，或 1-11 位短码前缀（如 6s2）。当前解码长度: " + bytes.length;
    }
};

Uis.normalizeUsid = function(value){
    const s = Uis.compactBase64(value);
    if(s.length === 0) throw "USID 不能为空。";

    const shortCode = Uis.shortCodeOf(s);
    if(shortCode != null){
        return shortCode.length === 3 ? Uis.randomUuidForShortId(shortCode) : Uis.clientUuidFromPrefix(shortCode);
    }

    let bytes;
    try{
        bytes = Uis.Base64Coder.decode(s);
    }catch(e){
        throw "USID 不是合法 Base64。";
    }

    if(bytes.length !== 8){
        throw "USID 建议/要求为 8 字节 Base64。当前解码长度: " + bytes.length;
    }
    return Uis.base64(bytes);
};

Uis.serverUuidFromClient = function(clientUuid){
    const raw = Uis.Base64Coder.decode(Uis.normalizeClientUuid(clientUuid));
    const crc = new Uis.CRC32();
    crc.update(raw, 0, raw.length);

    const buf = Uis.ByteBuffer.allocate(16);
    buf.put(raw);
    buf.putLong(crc.getValue());
    return Uis.base64(buf.array());
};

Uis.trim = function(value){
    return String(value == null ? "" : value).trim();
};

Uis.normalizeServerKey = function(value){
    let s = Uis.trim(value);
    if(s.length === 0) return "";

    // ArcNet's remote address is commonly "/127.0.0.1:6567".
    const slash = s.indexOf("/");
    if(slash >= 0) s = s.substring(slash + 1);

    if(s.indexOf("mindustry://") === 0) s = s.substring("mindustry://".length);
    if(s.indexOf("tcp://") === 0) s = s.substring("tcp://".length);

    while(s.indexOf("/") === 0) s = s.substring(1);
    while(s.lastIndexOf("/") === s.length - 1 && s.length > 0) s = s.substring(0, s.length - 1);

    return s.toLowerCase();
};

Uis.normalizeInputServer = function(ip, port){
    const raw = String(ip == null ? "" : ip);
    if(raw.indexOf(":") >= 0 && raw.lastIndexOf(":") === raw.indexOf(":")){
        return Uis.normalizeServerKey(raw);
    }
    return Uis.normalizeServerKey(raw + ":" + port);
};

Uis.noPort = function(key){
    key = Uis.normalizeServerKey(key);
    const idx = key.lastIndexOf(":");
    if(idx <= 0) return key;
    // Avoid damaging bracketless IPv6 too much.
    if(key.indexOf(":") !== idx && key.indexOf("[") !== 0) return key;
    return key.substring(0, idx);
};

Uis.splitHostPort = function(key){
    key = Uis.normalizeServerKey(key);
    if(key.length === 0) return null;

    if(key.charAt(0) === "["){
        const end = key.indexOf("]");
        if(end > 0 && key.length > end + 2 && key.charAt(end + 1) === ":"){
            return {host: key.substring(1, end), port: key.substring(end + 2)};
        }
        return null;
    }

    const idx = key.lastIndexOf(":");
    if(idx <= 0) return null;
    // Bracketless IPv6 with no clear port.
    if(key.indexOf(":") !== idx) return null;
    return {host: key.substring(0, idx), port: key.substring(idx + 1)};
};

Uis.isLiteralIp = function(host){
    host = String(host == null ? "" : host);
    return /^[0-9.]+$/.test(host) || host.indexOf(":") >= 0;
};

Uis.addVariant = function(out, value){
    value = Uis.normalizeServerKey(value);
    if(value.length === 0) return;
    for(let i = 0; i < out.length; i++){
        if(String(out[i]) === value) return;
    }
    out.push(value);
};

Uis.serverKeyVariants = function(key){
    const out = [];
    Uis.addVariant(out, key);

    const hp = Uis.splitHostPort(key);
    if(hp != null && hp.host.length > 0 && hp.port.length > 0){
        try{
            const addresses = Uis.InetAddress.getAllByName(hp.host);
            for(let i = 0; i < addresses.length; i++){
                Uis.addVariant(out, String(addresses[i].getHostAddress()) + ":" + hp.port);
            }
        }catch(e){
            // DNS is best effort; the connection path will still apply again
            // from Packets.Connect if reflection is available.
        }
    }

    if(Uis.pendingServerKey != null){
        Uis.addVariant(out, Uis.pendingServerKey);
        const pendingHp = Uis.splitHostPort(Uis.pendingServerKey);
        if(pendingHp != null && hp != null && pendingHp.port === hp.port){
            try{
                const pendingAddresses = Uis.InetAddress.getAllByName(pendingHp.host);
                for(let j = 0; j < pendingAddresses.length; j++){
                    Uis.addVariant(out, String(pendingAddresses[j].getHostAddress()) + ":" + pendingHp.port);
                }
            }catch(e2){
            }
        }
    }

    return out;
};

Uis.addUnique = function(arr, value){
    value = Uis.normalizeServerKey(value);
    if(value.length === 0) return;
    for(let i = 0; i < arr.length; i++){
        if(String(arr[i]) === value) return;
    }
    arr.push(value);
};

Uis.findIdentity = function(cfg, id){
    if(id == null) return null;
    for(let i = 0; i < cfg.identities.length; i++){
        if(String(cfg.identities[i].id) === String(id)) return cfg.identities[i];
    }
    return null;
};

Uis.findIdentityForServer = function(cfg, actualKey){
    const keys = [];
    actualKey = Uis.normalizeServerKey(actualKey);
    if(actualKey.length > 0){
        keys.push(actualKey);
        keys.push(Uis.noPort(actualKey));
    }

    if(Uis.pendingServerKey != null && Time.millis() - Uis.pendingServerAt < 30000){
        keys.push(Uis.pendingServerKey);
        keys.push(Uis.noPort(Uis.pendingServerKey));
    }

    for(let i = 0; i < keys.length; i++){
        const id = cfg.serverMap[keys[i]];
        const found = Uis.findIdentity(cfg, id);
        if(found != null) return {identity: found, matchedKey: keys[i]};
    }

    const def = Uis.findIdentity(cfg, cfg.defaultId);
    if(def != null) return {identity: def, matchedKey: "<default>"};

    return null;
};

Uis.createRandomIdentity = function(name, serverKey){
    const id = {
        id: Uis.newId(),
        name: name == null || String(name).trim().length === 0 ? "New Identity" : String(name).trim(),
        uuid: Uis.randomBase64(8),
        usid: Uis.randomBase64(8),
        servers: []
    };
    if(serverKey != null && String(serverKey).trim().length > 0){
        Uis.addUnique(id.servers, serverKey);
    }
    return id;
};

Uis.restoreVanillaForKeys = function(cfg, keys){
    cfg = Uis.ensureConfig(cfg);
    let changed = false;

    if(cfg.vanilla.uuid != null && String(cfg.vanilla.uuid).length > 0){
        const currentUuid = Uis.getSettingString("uuid", "");
        if(currentUuid !== String(cfg.vanilla.uuid)){
            Uis.putSettingString("uuid", cfg.vanilla.uuid);
            changed = true;
        }
    }

    for(let i = 0; i < keys.length; i++){
        const key = Uis.normalizeServerKey(keys[i]);
        if(key.length === 0) continue;
        const settingKey = "usid-" + key;
        const currentUsid = Uis.getSettingString(settingKey, null);

        if(Uis.hasOwn(cfg.vanilla.usids, key)){
            const vanillaUsid = String(cfg.vanilla.usids[key]);
            if(currentUsid !== vanillaUsid){
                Uis.putSettingString(settingKey, vanillaUsid);
                changed = true;
            }
        }else if(currentUsid != null && Uis.isKnownManagedUsid(cfg, currentUsid)){
            // If there was no pre-existing USID for this server, remove the
            // managed value and let vanilla getUsid() create one as needed.
            Uis.putSettingString(settingKey, null);
            changed = true;
        }
    }

    cfg.lastApplied = null;
    Uis.saveConfig(cfg);
    if(changed) Core.settings.forceSave();
    return changed;
};

Uis.applyIdentityToSettings = function(identity, actualServerKey, opts){
    if(identity == null) return false;
    opts = opts || {};
    const cfg = opts.cfg != null ? Uis.ensureConfig(opts.cfg) : Uis.loadConfig();

    const uuid = Uis.normalizeClientUuid(identity.uuid);
    const usid = Uis.normalizeUsid(identity.usid);
    const key = Uis.normalizeServerKey(actualServerKey);
    let keys = Uis.serverKeyVariants(key);
    if(opts.keys instanceof Array){
        for(let i = 0; i < opts.keys.length; i++){
            Uis.addVariant(keys, opts.keys[i]);
        }
    }

    Uis.rememberVanillaForKeys(cfg, keys);

    identity.uuid = uuid;
    identity.usid = usid;

    Core.settings.put("uuid", uuid);
    for(let i = 0; i < keys.length; i++){
        if(keys[i].length > 0){
            Core.settings.put("usid-" + keys[i], usid);
        }
    }

    cfg.lastApplied = {
        identityId: identity.id,
        uuid: uuid,
        usid: usid,
        keys: keys,
        at: Uis.System.currentTimeMillis()
    };
    Uis.saveConfig(cfg);

    Uis.lastAppliedIdentityId = identity.id;
    Uis.lastActualServerKey = key.length > 0 ? key : Uis.lastActualServerKey;
    return true;
};

Uis.applyForAddress = function(address, source){
    const actualKey = Uis.normalizeServerKey(address);
    Uis.lastActualServerKey = actualKey;
    const keys = Uis.serverKeyVariants(actualKey);

    const cfg = Uis.loadConfig();
    let found = Uis.findIdentityForServer(cfg, actualKey);

    if(found == null && cfg.autoCreate){
        const name = "Auto " + (actualKey.length > 0 ? actualKey : "server");
        const identity = Uis.createRandomIdentity(name, actualKey);
        cfg.identities.push(identity);
        if(actualKey.length > 0){
            cfg.serverMap[actualKey] = identity.id;
        }
        if(Uis.pendingServerKey != null){
            cfg.serverMap[Uis.pendingServerKey] = identity.id;
            Uis.addUnique(identity.servers, Uis.pendingServerKey);
        }
        Uis.saveConfig(cfg);
        found = {identity: identity, matchedKey: actualKey};
    }

    if(found != null){
        Uis.applyIdentityToSettings(found.identity, actualKey, {cfg: cfg, keys: keys});
        Uis.debug("[UUID Identity Switcher] Applied identity '" + found.identity.name + "' for server '" + actualKey + "' via " + String(source || "unknown") + " (matched '" + found.matchedKey + "').");
    }else{
        const restored = Uis.restoreVanillaForKeys(cfg, keys);
        Uis.debug("[UUID Identity Switcher] No identity mapped for server '" + actualKey + "' via " + String(source || "unknown") + "; vanilla identity " + (restored ? "restored." : "kept.") );
    }
};

Uis.getPrivateField = function(obj, name){
    let cls = obj.getClass();
    while(cls != null){
        try{
            const field = cls.getDeclaredField(name);
            field.setAccessible(true);
            return field.get(obj);
        }catch(e){
            cls = cls.getSuperclass();
        }
    }
    return null;
};

Uis.callNoArgMethod = function(obj, name){
    if(obj == null) return false;
    let cls = obj.getClass();
    while(cls != null){
        try{
            const methods = cls.getDeclaredMethods();
            for(let i = 0; i < methods.length; i++){
                const method = methods[i];
                if(String(method.getName()) === String(name) && method.getParameterTypes().length === 0){
                    method.setAccessible(true);
                    method.invoke(obj);
                    return true;
                }
            }
        }catch(e){
        }
        cls = cls.getSuperclass();
    }
    return false;
};

Uis.buildSettingsEntryTable = function(table){
    table.clearChildren();
    table.defaults().growX().pad(6);
    table.add("[accent]UUID Identity Switcher[]").left().wrap().row();
    table.add("用于管理本地 UUID/USID 身份。安卓/MindustryX 上请从这里打开管理器。").left().wrap().row();
    table.button("打开身份管理器", run(function(){
        Uis.showManagerDialog();
    })).height(60).row();

    const cfg = Uis.loadConfig();
    table.add("[lightgray]默认身份:[] " + (cfg.defaultId == null ? "[gray]<none>" : (Uis.findIdentity(cfg, cfg.defaultId) || {name: "<missing>"}).name)).left().wrap().row();
    table.add("[lightgray]上次服务器:[] " + (Uis.lastActualServerKey == null ? "[gray]<none>" : Uis.lastActualServerKey)).left().wrap().row();
};

Uis.installConnectHook = function(){
    if(Uis.connectHookInstalled || Uis.connectHookDisabled) return;
    if(Vars.net == null) return;
    if(Time.millis() < Uis.connectHookRetryAt) return;
    Uis.connectHookRetryAt = Time.millis() + 1000;

    const listeners = Uis.getPrivateField(Vars.net, "clientListeners");
    if(listeners == null){
        Uis.warnOnce("no-client-listeners", "[UUID Identity Switcher] Failed to access Net.clientListeners; Connect packet fallback is disabled. ClientServerConnectEvent switching is still active.");
        Uis.connectHookDisabled = true;
        return;
    }

    const original = listeners.get(Uis.ConnectClass);
    if(original == null){
        Uis.warnOnce("no-connect-listener", "[UUID Identity Switcher] Connect listener not found yet; will retry silently.");
        return;
    }

    listeners.put(Uis.ConnectClass, cons(function(packet){
        try{
            Uis.applyForAddress(packet.addressTCP, "connect-packet");
        }catch(e){
            Log.err("[UUID Identity Switcher] Failed to apply identity before connecting.", e);
            Vars.ui.showInfo("[scarlet]UUID Identity Switcher 应用身份失败：[]\n" + String(e));
        }
        original.get(packet);
    }));

    Uis.connectHookInstalled = true;
    Uis.debug("[UUID Identity Switcher] Connect hook installed.");
};

Uis.installEvents = function(){
    Events.on(Uis.ClientServerConnectEventClass, cons(function(e){
        Uis.pendingServerKey = Uis.normalizeInputServer(e.ip, e.port);
        Uis.pendingServerAt = Time.millis();
        try{
            Uis.applyForAddress(Uis.pendingServerKey, "connect-event");
        }catch(err){
            Log.err("[UUID Identity Switcher] Failed to apply identity from ClientServerConnectEvent.", err);
            Vars.ui.showInfo("[scarlet]UUID Identity Switcher 应用身份失败：[]\n" + String(err));
        }
    }));

    Events.on(Uis.ClientLoadEventClass, cons(function(){
        Uis.installConnectHook();
        Uis.installSettingsCategory();
    }));

    // Fallback/retry path: if script timing or another mod causes ClientLoadEvent
    // to be missed, this still injects the settings category and connect hook once ready.
    Events.run(Trigger.update, run(function(){
        if(!Uis.connectHookInstalled) Uis.installConnectHook();
        if(!Uis.categoryInstalled) Uis.installSettingsCategory();
    }));
};

Uis.short = function(value){
    const s = String(value == null ? "" : value);
    if(s.length <= 18) return s;
    return s.substring(0, 8) + "..." + s.substring(s.length - 6);
};

Uis.identitySummary = function(identity){
    let serverUuid = "";
    let uuidShort = "";
    let usidShort = "";
    let saShort = "";
    try{
        serverUuid = Uis.serverUuidFromClient(identity.uuid);
        uuidShort = serverUuid.substring(0, Math.min(3, serverUuid.length));
        saShort = Uis.shortIdFromString(serverUuid);
        usidShort = String(identity.usid || "").substring(0, Math.min(3, String(identity.usid || "").length));
    }catch(e){
        serverUuid = "[scarlet]<invalid>[]";
        uuidShort = "[scarlet]<invalid>[]";
        usidShort = "[scarlet]<invalid>[]";
        saShort = "[scarlet]<invalid>[]";
    }
    return "[lightgray]client uuid:[] " + Uis.short(identity.uuid) +
        "\n[lightgray]ScriptAgent shortID:[] " + saShort +
        "\n[lightgray]uuid short:[] " + uuidShort +
        "\n[lightgray]usid short:[] " + usidShort +
        "\n[lightgray]server uuid:[] " + Uis.short(serverUuid) +
        "\n[lightgray]usid:[] " + Uis.short(identity.usid) +
        "\n[lightgray]servers:[] " + (identity.servers.length === 0 ? "[gray]<none>" : identity.servers.join(", "));
};

Uis.showManagerDialog = function(){
    const dialog = new BaseDialog("UUID Identity");
    dialog.addCloseButton();
    dialog.cont.table(cons(function(t){
        Uis.buildManagerTable(t);
    })).grow();
    dialog.show();
};

Uis.buildManagerTable = function(root){
    Uis.managerTable = root;
    root.clearChildren();

    const cfg = Uis.loadConfig();
    root.pane(cons(function(pane){
        pane.defaults().growX().pad(4);

        const currentUuid = Core.settings.getString("uuid", "");
        pane.add("[accent]当前客户端 UUID:[] " + (currentUuid.length === 0 ? "[gray]<empty>" : currentUuid)).left().wrap().row();
        pane.add("[accent]已保存的原始 UUID:[] " + (cfg.vanilla.uuid == null ? "[gray]<not captured>" : Uis.short(cfg.vanilla.uuid))).left().wrap().row();
        pane.add("[accent]上次实际服务器:[] " + (Uis.lastActualServerKey == null ? "[gray]<none>" : Uis.lastActualServerKey)).left().wrap().row();
        pane.add("[accent]默认身份:[] " + (cfg.defaultId == null ? "[gray]<none>" : (Uis.findIdentity(cfg, cfg.defaultId) || {name: "<missing>"}).name)).left().wrap().row();
        pane.add("[accent]自动为未绑定服务器创建身份:[] " + (cfg.autoCreate ? "[green]on" : "[gray]off")).left().wrap().row();
        pane.add("[accent]调试日志:[] " + (cfg.debugLogs ? "[green]on" : "[gray]off")).left().wrap().row();

        pane.image().color(Pal.gray).height(3).padTop(8).padBottom(8).row();

        if(cfg.identities.length === 0){
            pane.add("[gray]还没有身份。点击下方“新增随机身份”。").left().wrap().row();
        }

        for(let i = 0; i < cfg.identities.length; i++){
            const identity = cfg.identities[i];
            pane.table(Tex.button, cons(function(row){
                row.defaults().pad(3);
                row.left();
                let title = "[accent]" + identity.name + "[]";
                if(String(cfg.defaultId) === String(identity.id)) title += " [yellow](default)[]";
                if(String(Uis.lastAppliedIdentityId) === String(identity.id)) title += " [green](last applied)[]";
                row.add(title + "\n" + Uis.identitySummary(identity)).left().wrap().growX();

                row.table(cons(function(btns){
                    btns.defaults().width(145).height(42).pad(2);
                    btns.button("应用为默认", run(function(){
                        try{
                            cfg.defaultId = identity.id;
                            Uis.applyIdentityToSettings(identity, Uis.lastActualServerKey, {cfg: cfg});
                            Vars.ui.showInfo("已应用并设为默认身份：" + identity.name + "\n没有服务器专属绑定时，下一次连接会使用它。");
                            Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
                        }catch(e){
                            Vars.ui.showInfo("[scarlet]" + String(e));
                        }
                    })).row();
                    btns.button("设为默认", run(function(){
                        cfg.defaultId = identity.id;
                        Uis.saveConfig(cfg);
                        Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
                    })).row();
                    btns.button("绑定服务器", run(function(){
                        Uis.promptBindServer(cfg, identity, {hide: function(){ Core.app.post(run(function(){ Uis.refreshManager(); })); }});
                    })).row();
                    btns.button("编辑", run(function(){
                        Core.app.post(run(function(){ Uis.showEditIdentity(identity.id); }));
                    })).row();
                    btns.button("[scarlet]删除", run(function(){
                        Vars.ui.showConfirm("@confirm", "删除身份 “" + identity.name + "”？", run(function(){
                            Uis.deleteIdentity(cfg, identity.id);
                            Uis.saveConfig(cfg);
                            Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
                        }));
                    })).row();
                })).right();
            })).growX().row();
        }
    })).grow().row();

    root.table(cons(function(buttons){
        buttons.defaults().height(56).pad(4);

        buttons.button("新增随机身份", run(function(){
            const next = Uis.createRandomIdentity("Identity " + (cfg.identities.length + 1), null);
            cfg.identities.push(next);
            Uis.saveConfig(cfg);
            Core.app.post(run(function(){
                Uis.refreshManager();
                Uis.showEditIdentity(next.id);
            }));
        })).width(190);

        buttons.button("从当前设置新增", run(function(){
            const next = Uis.createRandomIdentity("Current " + (cfg.identities.length + 1), Uis.lastActualServerKey);
            try{
                const curUuid = Core.settings.getString("uuid", "");
                if(curUuid.length > 0) next.uuid = Uis.normalizeClientUuid(curUuid);
                if(Uis.lastActualServerKey != null){
                    const curUsid = Core.settings.getString("usid-" + Uis.lastActualServerKey, "");
                    if(curUsid.length > 0) next.usid = Uis.normalizeUsid(curUsid);
                    cfg.serverMap[Uis.lastActualServerKey] = next.id;
                }
            }catch(e){
                Log.warn("[UUID Identity Switcher] Current settings contain invalid identity data: @", String(e));
            }
            cfg.identities.push(next);
            Uis.saveConfig(cfg);
            Core.app.post(run(function(){
                Uis.refreshManager();
                Uis.showEditIdentity(next.id);
            }));
        })).width(210);

        buttons.button(cfg.autoCreate ? "关闭自动创建" : "开启自动创建", run(function(){
            cfg.autoCreate = !cfg.autoCreate;
            Uis.saveConfig(cfg);
            Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
        })).width(190);

        buttons.button(cfg.debugLogs ? "关闭日志" : "开启日志", run(function(){
            cfg.debugLogs = !cfg.debugLogs;
            Uis.saveConfig(cfg);
            Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
        })).width(150);

        buttons.button("清除默认并还原", run(function(){
            cfg.defaultId = null;
            Uis.restoreVanillaForKeys(cfg, Uis.serverKeyVariants(Uis.lastActualServerKey));
            Core.app.post(run(function(){ Uis.buildManagerTable(root); }));
        })).width(190);
    })).growX().row();
};

Uis.refreshManager = function(){
    if(Uis.managerTable != null){
        Uis.buildManagerTable(Uis.managerTable);
    }
};

Uis.deleteIdentity = function(cfg, id){
    const next = [];
    for(let i = 0; i < cfg.identities.length; i++){
        if(String(cfg.identities[i].id) !== String(id)) next.push(cfg.identities[i]);
    }
    cfg.identities = next;
    if(String(cfg.defaultId) === String(id)) cfg.defaultId = null;
    for(let key in cfg.serverMap){
        if(String(cfg.serverMap[key]) === String(id)){
            delete cfg.serverMap[key];
        }
    }
};

Uis.saveIdentityFromFields = function(cfg, identity, nameField, uuidField, usidField, serversField, makeDefault){
    identity.name = Uis.trim(nameField.getText());
    if(identity.name.length === 0) identity.name = "Identity";

    const rawUuid = uuidField.getText();
    const shortCode = Uis.shortCodeOf(rawUuid);

    identity.uuid = Uis.normalizeClientUuid(rawUuid);

    // Important: many servers/plugins that show a 3-char "UID" are not
    // displaying vanilla player.uuid(); they often use a custom player code,
    // or sometimes USID. If the user typed a short code in the UUID field,
    // make both UUID and USID start with that code so either common source
    // can match it.
    if(shortCode != null){
        if(shortCode.length === 3){
            // ScriptAgent4MindustryExt's shortID is shortStr(player.uuid()),
            // i.e. md5(md5(uuidBytes)+uuidBytes) -> Base64 first 3 chars
            // with a few char replacements. USID is irrelevant there.
            identity.usid = Uis.normalizeUsid(usidField.getText());
        }else{
            identity.usid = Uis.clientUuidFromPrefix(shortCode);
        }
        usidField.setText(identity.usid);
    }else{
        identity.usid = Uis.normalizeUsid(usidField.getText());
    }

    // Remove old mappings owned by this identity; rebuild from text area.
    for(let key in cfg.serverMap){
        if(String(cfg.serverMap[key]) === String(identity.id)){
            delete cfg.serverMap[key];
        }
    }

    identity.servers = [];
    const lines = String(serversField.getText()).split(/\r?\n/);
    for(let i = 0; i < lines.length; i++){
        const key = Uis.normalizeServerKey(lines[i]);
        if(key.length === 0) continue;
        Uis.addUnique(identity.servers, key);
        cfg.serverMap[key] = identity.id;
    }

    if(makeDefault){
        cfg.defaultId = identity.id;
    }
};

Uis.promptBindServer = function(cfg, identity, parentDialog){
    let def = Uis.lastActualServerKey || Uis.pendingServerKey || "";
    if(identity.servers.length > 0) def = identity.servers[0];

    Vars.ui.showTextInput("绑定服务器", "输入服务器地址，可用 address:port 或域名:port", 128, def, false, cons(function(text){
        const key = Uis.normalizeServerKey(text);
        if(key.length === 0){
            Vars.ui.showInfo("[scarlet]服务器地址不能为空。");
            return;
        }
        cfg.serverMap[key] = identity.id;
        Uis.addUnique(identity.servers, key);
        Uis.saveConfig(cfg);
        parentDialog.hide();
        Core.app.post(run(function(){ Uis.refreshManager(); }));
    }));
};

Uis.showEditIdentity = function(id){
    const cfg = Uis.loadConfig();
    const identity = Uis.findIdentity(cfg, id);
    if(identity == null){
        Vars.ui.showInfo("[scarlet]身份不存在。");
        return;
    }

    const dialog = new BaseDialog("编辑身份");
    dialog.addCloseButton();

    const nameField = new TextField(String(identity.name));
    const uuidField = new TextField(String(identity.uuid));
    const usidField = new TextField(String(identity.usid));
    const serversField = new TextArea(String(identity.servers.join("\n")));
    serversField.setPrefRows(4);

    dialog.cont.table(cons(function(t){
        t.defaults().left().pad(4);
        t.add("名称").row();
        t.add(nameField).width(520).row();
        t.add("客户端 UUID（8 字节 Base64；也可输入 ScriptAgent 3位短ID 如 6s2/5pa/Ohk；会搜索对应 UUID）").wrap().row();
        t.add(uuidField).width(520).row();
        t.add("USID（8 字节 Base64）").wrap().row();
        t.add(usidField).width(520).row();
        t.add("绑定服务器列表，每行一个 address:port").wrap().row();
        t.add(serversField).width(520).height(120).row();
    })).growX().row();

    dialog.buttons.button("随机 UUID", run(function(){
        uuidField.setText(Uis.randomBase64(8));
    })).size(150, 60);

    dialog.buttons.button("ScriptAgent短ID转UUID", run(function(){
        try{
            const shortCode = Uis.shortCodeOf(uuidField.getText());
            if(shortCode != null){
                if(shortCode.length === 3){
                    uuidField.setText(Uis.randomUuidForShortId(shortCode));
                }else{
                    uuidField.setText(Uis.clientUuidFromPrefix(shortCode));
                    usidField.setText(Uis.clientUuidFromPrefix(shortCode));
                }
            }else{
                uuidField.setText(Uis.normalizeClientUuid(uuidField.getText()));
                usidField.setText(Uis.normalizeUsid(usidField.getText()));
            }
        }catch(e){
            Vars.ui.showInfo("[scarlet]转换失败：[]\n" + String(e));
        }
    })).size(220, 60);

    dialog.buttons.button("随机 USID", run(function(){
        usidField.setText(Uis.randomBase64(8));
    })).size(150, 60);

    dialog.buttons.button("全部随机", run(function(){
        uuidField.setText(Uis.randomBase64(8));
        usidField.setText(Uis.randomBase64(8));
    })).size(150, 60);

    dialog.buttons.button("[accent]保存", run(function(){
        try{
            Uis.saveIdentityFromFields(cfg, identity, nameField, uuidField, usidField, serversField, false);
            Uis.saveConfig(cfg);
            dialog.hide();
            Core.app.post(run(function(){ Uis.refreshManager(); }));
        }catch(e){
            Vars.ui.showInfo("[scarlet]保存失败：[]\n" + String(e));
        }
    })).size(150, 60);

    dialog.buttons.button("保存并设为默认", run(function(){
        try{
            Uis.saveIdentityFromFields(cfg, identity, nameField, uuidField, usidField, serversField, true);
            Uis.saveConfig(cfg);
            try{
                Uis.applyIdentityToSettings(identity, Uis.lastActualServerKey, {cfg: cfg});
            }catch(applyError){
                Log.warn("[UUID Identity Switcher] Saved default identity but could not apply immediately: @", String(applyError));
            }
            dialog.hide();
            Core.app.post(run(function(){ Uis.refreshManager(); }));
        }catch(e){
            Vars.ui.showInfo("[scarlet]保存失败：[]\n" + String(e));
        }
    })).size(190, 60);

    dialog.show();
};

Uis.installSettingsCategory = function(){
    if(Uis.categoryInstalled || Vars.ui == null || Vars.ui.settings == null) return;
    // Desktop-safe path: directly build the manager inside a normal settings
    // category. The Android-specific JavaAdapter/SettingsTable adapter path was
    // removed because a missing/changed private SettingsMenuDialog$Setting class
    // can abort script loading before the desktop hook is installed.
    Vars.ui.settings.addCategory("UUID Identity", cons(function(table){
        Uis.buildManagerTable(table);
    }));
    Uis.categoryInstalled = true;
};

Uis.hideCurrentModFromServerList();
Uis.initializeConfig();
Uis.installEvents();

Log.info("[UUID Identity Switcher] Loaded as " + Uis.currentModName() + ".");
