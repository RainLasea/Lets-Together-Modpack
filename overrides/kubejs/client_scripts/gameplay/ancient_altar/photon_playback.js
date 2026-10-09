// KubeJS 2101.7.2-build.377 / Photon 2.2.7. Client classes stay on this side.
// Server commands handle playback. This script verifies real resources and confirms real runtimes.
;(function () {
    var protocol = 'ancient-altar-v1'
    var normalId = 'lets_together:ancient_altar'
    var reducedId = 'lets_together:ancient_altar_no_post'
    var helper = null
    var executor = null
    var positionClass = null
    var resourceClass = null
    var trailClass = null
    var beamClass = null
    var ready = false
    var clock = 0
    var watches = []

    function resourcesValid() {
        var full = helper.getFX(resourceClass.parse(normalId))
        var reduced = helper.getFX(resourceClass.parse(reducedId))
        if (full === null || reduced === null) return false
        if (full.getFxData().objects().size() !== 44 || reduced.getFxData().objects().size() !== 44) return false
        var definitions = [full, reduced]
        for (var definitionIndex = 0; definitionIndex < definitions.length; definitionIndex++) {
            var objects = definitions[definitionIndex].getFxData().objects()
            var trailCount = 0
            var vortexCount = 0
            var beamCount = 0
            for (var objectIndex = 0; objectIndex < objects.size(); objectIndex++) {
                var object = objects.get(objectIndex)
                var name = String(object.getName())
                if (name.indexOf('v4_') !== 0 || name.indexOf('v4_rift_helix_') === 0 || name.indexOf('v4_fracture_') === 0) return false
                if (name.indexOf('v4_inward_vortex_') === 0) vortexCount++
                if (object instanceof trailClass) {
                    trailCount++
                    if (object.config.renderer.isUseGPUInstance() || object.config.getStartDelay() !== 0 ||
                        String(object.config.renderer.getCompositeMode()) !== 'VANILLA') return false
                } else if (object instanceof beamClass) {
                    var beamConfig = object.getConfig()
                    if (beamConfig.getStartDelay() !== 0 || beamConfig.isLooping() || beamConfig.renderer.isUseGPUInstance() ||
                        String(beamConfig.renderer.getCompositeMode()) !== 'VANILLA' || beamConfig.getEnd().y() !== 256 ||
                        Math.abs(object.transform().localPosition().y() - 1.70) > 0.001) return false
                    beamCount++
                }
            }
            if (trailCount !== 26 || beamCount !== 2 || vortexCount !== 6) return false
        }
        return true
    }
    function reportReady(player, value) {
        ready = value
        player.sendData('lt_altar_fx_ready', { protocol: protocol, ready: ready })
    }
    function verify(player) {
        try {
            if (!Platform.isLoaded('photon')) { reportReady(player, false); return }
            if (Java.loadClass('net.minecraft.client.Minecraft').getInstance().getOverlay() !== null) return
            if (helper === null) {
                helper = Java.loadClass('com.lowdragmc.photon.client.fx.FXHelper')
                executor = Java.loadClass('com.lowdragmc.photon.client.fx.BlockEffectExecutor')
                positionClass = Java.loadClass('net.minecraft.core.BlockPos')
                resourceClass = Java.loadClass('net.minecraft.resources.ResourceLocation')
                trailClass = Java.loadClass('com.lowdragmc.photon.client.gameobject.emitter.trail.TrailEmitter')
                beamClass = Java.loadClass('com.lowdragmc.photon.client.gameobject.emitter.beam.BeamEmitter')
                helper.clearCache()
            }
            reportReady(player, resourcesValid())
        } catch (failure) {
            reportReady(player, false)
        }
    }

    ClientEvents.loggedIn(function (event) { clock = 0; watches = []; ready = false; verify(event.player) })
    ClientEvents.loggedOut(function () { watches = []; ready = false })
    NetworkEvents.dataReceived('lt_altar_check', function (event) { verify(event.player) })
    NetworkEvents.dataReceived('lt_altar_watch', function (event) {
        var data = event.data
        if (data === null || String(data.getString('protocol')) !== protocol) return
        if (!ready) verify(event.player)
        if (!ready) return
        watches.push({
            token: String(data.getString('token')), dimension: String(data.getString('dimension')),
            x: data.getInt('x'), y: data.getInt('y'), z: data.getInt('z'),
            fx: String(data.getString('fx')), deadline: clock + 55
        })
    })
    ClientEvents.tick(function (event) {
        clock++
        // Periodic handshake also recovers after a server /reload or client F3+T.
        if (clock % 100 === 20) verify(event.player)
        for (var watchIndex = watches.length - 1; watchIndex >= 0; watchIndex--) {
            var watch = watches[watchIndex]
            if (clock > watch.deadline) { watches.splice(watchIndex, 1); continue }
            if (String(event.level.dimension) !== watch.dimension) { watches.splice(watchIndex, 1); continue }
            try {
                var bucket = executor.CACHE.get(new positionClass(watch.x, watch.y, watch.z))
                if (bucket === null) continue
                for (var effectIndex = 0; effectIndex < bucket.size(); effectIndex++) {
                    var effect = bucket.get(effectIndex)
                    var runtime = effect.getRuntime()
                    if (String(effect.getFx().getFxLocation()) === watch.fx && String(effect.getLevel().dimension) === watch.dimension &&
                        runtime !== null && runtime.isValid() && !runtime.isFinished()) {
                        event.player.sendData('lt_altar_playback', { protocol: protocol, token: watch.token })
                        watches.splice(watchIndex, 1)
                        break
                    }
                }
            } catch (failure) {
                watches.splice(watchIndex, 1)
            }
        }
    })
})()
