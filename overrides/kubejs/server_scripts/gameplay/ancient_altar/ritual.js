// Ancient Altar — Minecraft 1.21.1 / NeoForge / KubeJS 2101.7.2-build.377.
// Gameplay only. Photon owns the authored 260-tick visual timeline.
;(function () {
    var Core = 'irons_spellbooks:pedestal'
    var Protocol = 'ancient-altar-v1'
    var RootKey = 'ltAncientAltarsV1'
    var Epoch = String(Date.now()) + '-' + String(Math.random())
    var MaxPillarRadius = 4 // Inclusive footprint: 2 * radius + 1, at most 9 x 9.
    var Tag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var Pos = Java.loadClass('net.minecraft.core.BlockPos')
    var Hand = Java.loadClass('net.minecraft.world.InteractionHand')
    var Pedestal = Java.loadClass('io.redspace.ironsspellbooks.block.pedestal.PedestalTile')
    var Stack = Java.loadClass('net.minecraft.world.item.ItemStack')
    var ItemEntity = Java.loadClass('net.minecraft.world.entity.item.ItemEntity')
    var Living = Java.loadClass('net.minecraft.world.entity.LivingEntity')
    var Mob = Java.loadClass('net.minecraft.world.entity.Mob')
    var SpawnType = Java.loadClass('net.minecraft.world.entity.MobSpawnType')
    var Hooks = Java.loadClass('net.neoforged.neoforge.event.EventHooks')
    var Registry = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var Resource = Java.loadClass('net.minecraft.resources.ResourceLocation')
    var SoundSource = Java.loadClass('net.minecraft.sounds.SoundSource')
    var UUID = Java.loadClass('java.util.UUID')
    var clientReady = {}
    var config = null
    var fxName = 'lets_together:ancient_altar'

    function validId(value) { return typeof value === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) }
    function integer(value, minimum, maximum) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= minimum && value <= maximum }
    try {
        config = JSON.parse(JsonIO.readString('kubejs/config/gameplay/ancient_altar.json'))
        if (!config || !config.offering || !validId(config.offering.item)) throw new Error('offering.item 必须是完整物品 ID')
        // Iron's 3.16.3 useItemOn ALWAYS places one item. Reject inaccessible multi-item recipes.
        if (config.offering.count !== 1) throw new Error('当前 Pedestal 每次只展示 1 个物品，offering.count 必须为 1')
        if (config.bossId !== '' && !validId(config.bossId)) throw new Error('bossId 必须为空或完整实体 ID')
        if (!integer(config.playbackTimeoutTicks, 20, 200)) throw new Error('playbackTimeoutTicks 必须为 20–200')
        if (!Array.isArray(config.bossSpawnOffset) || config.bossSpawnOffset.length !== 3) throw new Error('bossSpawnOffset 必须有三个数值')
        config.bossSpawnOffset.forEach(function (offset) { if (typeof offset !== 'number' || !isFinite(offset) || Math.abs(offset) > 16) throw new Error('Boss 偏移必须在 ±16 格内') })
        ;['enabled', 'requireSpawnClearance', 'consumeInPreview', 'postProcessing', 'requireClientPlaybackConfirmation'].forEach(function (option) {
            if (typeof config[option] !== 'boolean') throw new Error(option + ' 必须是布尔值')
        })
        ;['breath', 'pillar', 'converge', 'compress', 'ascent', 'release'].forEach(function (soundKey) {
            if (!config.sounds || !validId(config.sounds[soundKey])) throw new Error('sounds.' + soundKey + ' 无效')
        })
        if (!config.postProcessing) fxName = 'lets_together:ancient_altar_no_post'
    } catch (failure) {
        config = null
    }

    // LevelMixin remaps getGameTime -> getTime; use the explicit KubeJS getter.
    function now(server) { return Number(server.getOverworld().getTime()) }
    function dimension(level) { return String(level.dimension) }
    function key(level, block) { return dimension(level) + '|' + block.x + ',' + block.y + ',' + block.z }
    function root(server) {
        var data = server.persistentData
        if (!data.contains(RootKey)) data.put(RootKey, new Tag())
        return data.getCompound(RootKey)
    }
    function location(record) { return new Pos(record.getInt('x'), record.getInt('y'), record.getInt('z')) }
    function levelOf(server, record) { return server.getLevel(record.getString('dimension')) }
    function deny(event) { event.cancel() }
    function pillars(radiusX, radiusZ) {
        return [[-radiusX, -radiusZ], [radiusX, -radiusZ], [radiusX, radiusZ], [-radiusX, radiusZ]]
    }
    function recordPillars(record) {
        // Existing locks from the fixed 5 x 5 layout still protect their original blocks.
        return pillars(record.contains('radiusX') ? record.getInt('radiusX') : 2,
            record.contains('radiusZ') ? record.getInt('radiusZ') : 2)
    }
    function loadedStructure(level, block, corners) {
        if (!level.hasChunkAt(new Pos(block.x, block.y, block.z))) return false
        for (var pillarIndex = 0; pillarIndex < 4; pillarIndex++)
            if (!level.hasChunkAt(new Pos(block.x + corners[pillarIndex][0], block.y, block.z + corners[pillarIndex][1]))) return false
        return true
    }
    function structure(level, block, corners) {
        if (!loadedStructure(level, block, corners)) return '祭坛所在区块尚未加载'
        if (String(block.id) !== Core) return '中央核心不是 Pedestal'
        for (var pillarIndex = 0; pillarIndex < 4; pillarIndex++) {
            var dx = corners[pillarIndex][0], dz = corners[pillarIndex][1]
            for (var height = 0; height < 3; height++) {
                var part = level.getBlock(block.x + dx, block.y + height, block.z + dz)
                if (height === 2 ? !(part.hasTag('minecraft:walls') && part.hasTag('minecraft:mineable/pickaxe')) : !part.hasTag('minecraft:mineable/pickaxe'))
                    return '第 ' + (pillarIndex + 1) + ' 根柱子 [' + dx + ',' + height + ',' + dz + '] 方块不正确'
            }
        }
        return '' // Exactly 13 key blocks. Floor and decoration are intentionally outside validation.
    }
    function findStructure(level, block) {
        // Search symmetric rectangles, smallest X radius then smallest Z radius first.
        // Only the selected corners need loaded chunks; never read unloaded candidates.
        for (var radiusX = 1; radiusX <= MaxPillarRadius; radiusX++) {
            for (var radiusZ = 1; radiusZ <= MaxPillarRadius; radiusZ++) {
                if (structure(level, block, pillars(radiusX, radiusZ)) === '')
                    return { radiusX: radiusX, radiusZ: radiusZ }
            }
        }
        return null
    }
    function command(server, level, text) {
        // runCommandSilent is VOID in 2101; the actual dispatcher returns a success count.
        var source = server.createCommandSourceStack().withLevel(level).withSuppressedOutput()
        return server.getCommands().getDispatcher().execute(text, source)
    }
    function stopFX(server, record) {
        var world = levelOf(server, record)
        if (world === null || !world.hasChunkAt(location(record)) || !Platform.isLoaded('photon')) return
        try { command(server, world, 'photon fx remove block ' + record.getInt('x') + ' ' + record.getInt('y') + ' ' + record.getInt('z') + ' true ' + record.getString('fx')) }
        catch (failure) {}
    }
    function sound(server, record, soundKey, volume, pitch, dx, dy, dz) {
        var world = levelOf(server, record)
        if (world === null) return
        var soundId = record.getCompound('sounds').getString(soundKey)
        var soundEvent = Registry.SOUND_EVENT.get(Resource.parse(soundId))
        if (soundEvent === null) return
        world.playSound(null, record.getInt('x') + 0.5 + dx, record.getInt('y') + dy,
            record.getInt('z') + 0.5 + dz, soundEvent, SoundSource.BLOCKS, volume, pitch)
    }
    function refund(server, record) {
        if (!record.contains('reserved')) return true
        var world = levelOf(server, record)
        if (world === null || !world.hasChunkAt(location(record))) return false
        var reserved = Stack.parseOptional(server.registryAccess(), record.getCompound('reserved'))
        if (reserved.isEmpty()) throw new Error('持久化祭品无法恢复，保留退款记录供排查')
        var tile = world.getBlockEntity(location(record))
        if (tile instanceof Pedestal && tile.getHeldItem().isEmpty()) tile.setHeldItem(reserved)
        else {
            var drop = new ItemEntity(world, record.getInt('x') + 0.5, record.getInt('y') + 1.15, record.getInt('z') + 0.5, reserved)
            drop.setDefaultPickUpDelay()
            if (!world.addFreshEntity(drop)) return false
        }
        record.remove('reserved')
        return true
    }
    function abort(server, record, reason) {
        record.putString('status', 'refund_pending')
        record.putString('reason', reason)
        stopFX(server, record)
        if (refund(server, record)) root(server).remove(record.getString('key'))
    }
    function prepareBoss(world, record) {
        var entityType = Registry.ENTITY_TYPE.get(Resource.parse(record.getString('bossId')))
        var boss = entityType.create(world)
        if (boss === null || !(boss instanceof Living)) throw new Error('bossId 必须能创建活体实体')
        boss.setPositionAndRotation(record.getInt('x') + 0.5 + record.getDouble('spawnX'),
            record.getInt('y') + record.getDouble('spawnY'), record.getInt('z') + 0.5 + record.getDouble('spawnZ'), 0, 0)
        if (record.getBoolean('clearance') && !world.noCollision(boss)) throw new Error('Boss 出生空间被方块或实体阻挡')
        return boss
    }
    function complete(server, record) {
        var world = levelOf(server, record)
        var bossId = String(record.getString('bossId'))
        if (bossId !== '') {
            var boss = prepareBoss(world, record)
            if (boss instanceof Mob) {
                Hooks.finalizeMobSpawn(boss, world, world.getCurrentDifficultyAt(boss.blockPosition()), SpawnType.EVENT, null)
                boss.setPersistenceRequired()
            }
            boss.addTag('lt_ancient_altar_boss')
            boss.persistentData.putString('ltAncientAltarKey', record.getString('key'))
            if (!world.addFreshEntity(boss)) throw new Error('Boss 生成被游戏或其他模组拒绝')
        }
        // Commit only after successful spawn (or an explicitly configured consuming preview).
        record.remove('reserved')
        record.putString('status', 'finishing') // Keep only the remaining visual tail locked.
    }
    function ritualTick(server, record) {
        if (String(record.getString('epoch')) !== Epoch) { abort(server, record, '脚本重载或服务器重启'); return }
        var world = levelOf(server, record)
        if (world === null) { abort(server, record, '祭坛维度已卸载'); return }
        var pos = location(record)
        var coreBlock = { x: pos.getX(), y: pos.getY(), z: pos.getZ(), id: Core }
        var corners = recordPillars(record)
        if (!loadedStructure(world, coreBlock, corners)) { abort(server, record, '祭坛区块已卸载'); return }
        coreBlock.id = String(world.getBlock(pos.getX(), pos.getY(), pos.getZ()).id)
        var invalid = structure(world, coreBlock, corners)
        if (invalid !== '') { abort(server, record, invalid); return }
        var elapsed = now(server) - Number(record.getLong('start'))
        if (elapsed < 0 || elapsed > 300) { abort(server, record, '仪式计时异常'); return }
        if (record.getBoolean('requireConfirmation') && !record.getBoolean('confirmed') && elapsed >= record.getInt('timeout')) {
            abort(server, record, '客户端未确认 Photon 播放'); return
        }
        var previous = record.getInt('lastTick')
        for (var pillarIndex = 0; pillarIndex < 4; pillarIndex++) {
            var wakeTick = 22 + 12 * pillarIndex
            if (previous < wakeTick && elapsed >= wakeTick)
                sound(server, record, 'pillar', 0.42, 0.62 + 0.08 * pillarIndex, corners[pillarIndex][0], 2.94, corners[pillarIndex][1])
        }
        if (previous < 76 && elapsed >= 76) sound(server, record, 'converge', 0.38, 0.72, 0, 1.38, 0)
        if (previous < 194 && elapsed >= 194) sound(server, record, 'compress', 0.42, 0.55, 0, 1.38, 0)
        if (previous < 216 && elapsed >= 216) sound(server, record, 'ascent', 0.48, 0.8, 0, 1.38, 0)
        if (previous < 244 && elapsed >= 244) sound(server, record, 'release', 0.85, 0.68, 0, 1.38, 0)
        record.putInt('lastTick', elapsed)
        if (elapsed >= 252) complete(server, record)
    }
    NetworkEvents.dataReceived('lt_altar_fx_ready', function (event) {
        if (event.data !== null && String(event.data.getString('protocol')) === Protocol)
            clientReady[String(event.player.uuid)] = event.data.getBoolean('ready')
    })
    NetworkEvents.dataReceived('lt_altar_playback', function (event) {
        if (event.data === null || String(event.data.getString('protocol')) !== Protocol) return
        var records = root(event.server), iterator = records.getAllKeys().iterator()
        while (iterator.hasNext()) {
            var record = records.getCompound(iterator.next())
            if (String(record.getString('status')) === 'ritual' && String(record.getString('owner')) === String(event.player.uuid) &&
                String(record.getString('token')) === String(event.data.getString('token'))) {
                record.putBoolean('confirmed', true)
            }
        }
    })
    PlayerEvents.loggedOut(function (event) { delete clientReady[String(event.player.uuid)] })

    BlockEvents.rightClicked(function (event) {
        if (String(event.block.id) !== Core) return
        var altarKey = key(event.level, event.block), records = root(event.server)
        var existing = records.getCompound(altarKey), existingStatus = String(existing.getString('status'))
        // Lock both hands before filtering main-hand activation; vanilla item swapping must not run.
        if (existingStatus === 'ritual' || existingStatus === 'finishing' || existingStatus === 'refund_pending') { deny(event); return }
        if (event.hand !== Hand.MAIN_HAND || !event.player.isShiftKeyDown() || !event.item.isEmpty()) return
        if (config === null) { deny(event); return }
        if (!config.enabled) { deny(event); return }
        var layout = findStructure(event.level, event.block)
        if (layout === null) { deny(event); return }
        var tile = event.block.entity
        if (!(tile instanceof Pedestal)) { deny(event); return }
        var offering = tile.getHeldItem()
        if (offering.isEmpty() || String(offering.id) !== config.offering.item || offering.getCount() < config.offering.count) {
            deny(event); return
        }
        if (!Registry.ITEM.containsKey(Resource.parse(config.offering.item))) { deny(event); return }
        if (config.bossId !== '' && (!Registry.ENTITY_TYPE.containsKey(Resource.parse(config.bossId)) || !Registry.ENTITY_TYPE.get(Resource.parse(config.bossId)).canSummon())) {
            deny(event); return
        }
        if (!Platform.isLoaded('photon')) { deny(event); return }
        if (clientReady[String(event.player.uuid)] !== true) {
            event.player.sendData('lt_altar_check', {})
            deny(event); return
        }
        var record = new Tag(), token = String(UUID.randomUUID())
        record.putString('key', altarKey); record.putString('dimension', dimension(event.level))
        record.putInt('x', event.block.x); record.putInt('y', event.block.y); record.putInt('z', event.block.z)
        record.putInt('radiusX', layout.radiusX); record.putInt('radiusZ', layout.radiusZ)
        record.putString('owner', String(event.player.uuid)); record.putString('token', token); record.putString('epoch', Epoch)
        record.putString('bossId', config.bossId); record.putString('fx', fxName)
        record.putDouble('spawnX', config.bossSpawnOffset[0]); record.putDouble('spawnY', config.bossSpawnOffset[1]); record.putDouble('spawnZ', config.bossSpawnOffset[2])
        record.putInt('timeout', config.playbackTimeoutTicks)
        record.putBoolean('clearance', config.requireSpawnClearance); record.putBoolean('requireConfirmation', config.requireClientPlaybackConfirmation)
        record.putBoolean('confirmed', false); record.putInt('lastTick', 0)
        var sounds = new Tag()
        Object.keys(config.sounds).forEach(function (soundKey) { sounds.putString(soundKey, config.sounds[soundKey]) })
        record.put('sounds', sounds)
        try {
            if (config.bossId !== '') prepareBoss(event.level, record) // Validate living type and spawn clearance before charging.
            record.putString('status', 'ritual'); record.putLong('start', now(event.server))
            records.put(altarKey, record) // Synchronous per-dimension lock; no scheduled orphan callbacks.
            if (config.bossId !== '' || config.consumeInPreview) {
                var heldCopy = offering.copy()
                record.put('reserved', offering.copyWithCount(config.offering.count).save(event.server.registryAccess()))
                heldCopy.shrink(config.offering.count)
                tile.setHeldItem(heldCopy) // Actual Iron's API; automatically marks dirty and updates clients.
            }
            event.player.sendData('lt_altar_watch', { protocol: Protocol, token: token, dimension: dimension(event.level),
                x: event.block.x, y: event.block.y, z: event.block.z, fx: fxName })
            // BlockEffectExecutor anchors at block CENTER; -0.5Y aligns authored coordinates to pedestal base.
            var result = command(event.server, event.level, 'photon fx ' + fxName + ' block ' + event.block.x + ' ' + event.block.y + ' ' + event.block.z + ' 0 -0.5 0 0 0 0 ' + (layout.radiusX / 2) + ' 1 ' + (layout.radiusZ / 2) + ' 0 true false false')
            if (result < 1) throw new Error('Photon 命令未成功执行')
            sound(event.server, record, 'breath', 0.32, 0.58, 0, 1.24, 0)
        } catch (failure) {
            if (String(record.getString('status')) === 'ritual') abort(event.server, record, String(failure))
        }
        // cancel() aborts the callback in KubeJS 2101. All mutation and registration is already done.
        event.cancel()
    })

    BlockEvents.broken(function (event) {
        var records = root(event.server), iterator = records.getAllKeys().iterator()
        while (iterator.hasNext()) {
            var record = records.getCompound(iterator.next())
            if ((String(record.getString('status')) !== 'ritual' && String(record.getString('status')) !== 'finishing') || String(record.getString('dimension')) !== dimension(event.level)) continue
            var dx = event.block.x - record.getInt('x'), dy = event.block.y - record.getInt('y'), dz = event.block.z - record.getInt('z')
            var corners = recordPillars(record)
            if ((dx === 0 && dy === 0 && dz === 0) || (Math.abs(dx) === Math.abs(corners[0][0]) && Math.abs(dz) === Math.abs(corners[0][1]) && dy >= 0 && dy <= 2)) {
                event.cancel()
            }
        }
    })
    ServerEvents.tick(function (event) {
        var records = root(event.server), iterator = records.getAllKeys().iterator(), keys = []
        while (iterator.hasNext()) keys.push(String(iterator.next()))
        for (var recordIndex = 0; recordIndex < keys.length; recordIndex++) {
            var record = records.getCompound(keys[recordIndex]), status = String(record.getString('status'))
            try {
                if (status === 'ritual') ritualTick(event.server, record)
                else if (status === 'refund_pending' && refund(event.server, record)) records.remove(keys[recordIndex])
                else if (status === 'finishing' && now(event.server) - Number(record.getLong('start')) >= 260) {
                    stopFX(event.server, record)
                    records.remove(keys[recordIndex])
                }
                else if (status === 'cooldown' || status === 'boss') records.remove(keys[recordIndex]) // Migrate old locks.
            } catch (failure) {
                if (status === 'ritual') abort(event.server, record, String(failure))
            }
        }
    })
})()
