// Gliders 1.1.8 / Photon 2.2.7. One persistent FX per deployed glider.
;(function () {
    if (!Platform.isLoaded('vc_gliders') || !Platform.isLoaded('photon')) return

    var Minecraft = Java.loadClass('net.minecraft.client.Minecraft')
    var GliderUtil = Java.loadClass('net.venturecraft.gliders.util.GliderUtil')
    var FXHelper = Java.loadClass('com.lowdragmc.photon.client.fx.FXHelper')
    var EntityEffect = Java.loadClass('com.lowdragmc.photon.client.fx.EntityEffectExecutor')
    var AutoRotate = Java.loadClass('com.lowdragmc.photon.client.fx.EntityEffectExecutor$AutoRotate')
    var ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
    var Vector3f = Java.loadClass('org.joml.Vector3f')
    var Quaternionf = Java.loadClass('org.joml.Quaternionf')
    var effectId = ResourceLocation.parse('lets_together:glider_trails')

    // The .fx places the air trails slightly inside the neutral outer canopy edge.
    // Lateral offsets +/-0.95, rear offset -0.6875, in blocks.
    var canopyHeight = 2.527
    var rangeSquared = 48 * 48
    var teleportSquared = 8 * 8
    var active = {}
    var world = null
    var fx = null
    var clock = 0
    var retryAt = 0
    var warned = false
    var initialized = false

    function stop(effect, immediate) {
        var runtime = effect.getRuntime()
        if (runtime !== null) runtime.destroy(immediate)
        var bucket = EntityEffect.CACHE.get(effect.entity)
        if (bucket !== null) {
            bucket.remove(effect)
            if (bucket.isEmpty()) EntityEffect.CACHE.remove(effect.entity)
        }
    }
    function clear() {
        for (var key in active) stop(active[key].effect, true)
        active = {}
        fx = null
    }
    function clearOrphans() {
        // A client script reload must also retire runtimes from the previous script.
        var iterator = EntityEffect.CACHE.entrySet().iterator()
        while (iterator.hasNext()) {
            var bucket = iterator.next().getValue()
            for (var i = bucket.size() - 1; i >= 0; i--) {
                var effect = bucket.get(i)
                if (String(effect.getFx().getFxLocation()) !== String(effectId)) continue
                var runtime = effect.getRuntime()
                if (runtime !== null) runtime.destroy(true)
                bucket.remove(i)
            }
            if (bucket.isEmpty()) iterator.remove()
        }
    }
    function eligible(player, viewer) {
        return player.isAlive() && !player.isSpectator() && !player.isInvisibleTo(viewer) &&
            player.distanceToEntitySqr(viewer) <= rangeSquared && GliderUtil.isGlidingWithActiveGlider(player)
    }
    function begin(level, player) {
        if (fx === null) {
            fx = FXHelper.getFX(effectId)
            if (fx === null) throw new Error('Missing Photon FX: ' + effectId)
        }
        var effect = new EntityEffect(fx, level, player, AutoRotate.XROT)
        // Photon follows eye position. Anchor height is relative to the feet.
        effect.setOffset(new Vector3f(0, canopyHeight - player.getEyeHeight(), 0))
        // XROT adds -90 degrees; compensate so local X spans the player's body.
        effect.setRotation(new Quaternionf().rotateY(Math.PI / 2))
        effect.setAllowMulti(true)
        effect.start()
        var runtime = effect.getRuntime()
        if (runtime === null) throw new Error('Photon did not start glider trails')
        effect.updateFXObjectFrame(runtime.getRoot(), 1)
        return effect
    }

    ClientEvents.loggedOut(function () {
        clear()
        clearOrphans()
        world = null
        retryAt = 0
    })
    ClientEvents.tick(function () {
        clock++
        var client = Minecraft.getInstance()
        var level = client.level
        var viewer = client.player
        if (!initialized) { clearOrphans(); initialized = true }
        if (level !== world) { clear(); world = level; retryAt = 0 }
        if (level === null || viewer === null) return
        // F3+T: stop old geometry and resolve the reloaded FX after the overlay closes.
        if (client.getOverlay() !== null) { clear(); return }
        if (clock < retryAt) return

        try {
            var seen = {}
            // ClientLevelMixin hides players(); EntityGetterKJS exposes getPlayers()/players.
            var players = level.players
            for (var i = 0; i < players.size(); i++) {
                var player = players.get(i)
                // EntityMixin remaps the vanilla getUUID() name to getUuid() in scripts.
                var key = String(player.getUuid())
                var entry = active[key]
                if (!eligible(player, viewer)) continue
                var position = player.position()
                if (entry !== undefined) {
                    var runtime = entry.effect.getRuntime()
                    var teleported = position.distanceToSqr(entry.position) > teleportSquared
                    if (entry.player !== player || teleported || !runtime.isValid() || runtime.isFinished()) {
                        stop(entry.effect, true)
                        delete active[key]
                        entry = undefined
                        fx = null
                    }
                }
                if (entry === undefined) {
                    entry = { effect: begin(level, player), player: player, position: position }
                    active[key] = entry
                }
                entry.effect.setOffset(new Vector3f(0, canopyHeight - player.getEyeHeight(), 0))
                entry.position = position
                seen[key] = true
            }
            for (var key in active) {
                if (seen[key]) continue
                // Natural wing closure stops emission; remaining trail fades over 0.6 s.
                var entry = active[key]
                stop(entry.effect, entry.player.isRemoved() || !entry.player.isAlive())
                delete active[key]
            }
        } catch (failure) {
            clear()
            retryAt = clock + 200
            if (!warned) {
                console.warn('[Glider trails] ' + failure)
                warned = true
            }
        }
    })
})()
