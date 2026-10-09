var FIRST_JOIN_COURIER = {
  item: 'map_atlases:atlas', delay: 60,
  distance: 14, maxDistance: 48,
  speed: 0.65, departureSpeed: 0.9, repathTicks: 20,
  approachTimeout: 600, departureTimeout: 240, maxPathChecks: 128,
  hiddenDistance: 3, searchCandidatesPerTick: 64, searchPathsPerTick: 2,
  tag: 'letstogether_first_join_courier'
}
var FirstJoinBlockPos = Java.loadClass('net.minecraft.core.BlockPos')
var FirstJoinAttributes = Java.loadClass('net.minecraft.world.entity.ai.attributes.Attributes')
var FirstJoinVec3 = Java.loadClass('net.minecraft.world.phys.Vec3')
var FirstJoinClipContext = Java.loadClass('net.minecraft.world.level.ClipContext')
var FirstJoinClipBlock = Java.loadClass('net.minecraft.world.level.ClipContext$Block')
var FirstJoinClipFluid = Java.loadClass('net.minecraft.world.level.ClipContext$Fluid')
var FirstJoinHitType = Java.loadClass('net.minecraft.world.phys.HitResult$Type')
var FirstJoinMapItem = Java.loadClass('net.minecraft.world.item.MapItem')
var FirstJoinMapAtlasItem = Java.loadClass('pepjebs.mapatlases.item.MapAtlasItem')
var FirstJoinAtlasUtils = Java.loadClass('pepjebs.mapatlases.utils.MapAtlasesAccessUtils')
var firstJoinDeliveries = new Map()
var firstJoinCourierCleanupNeeded = true

function firstJoinGiveMap(player) {
  if (player.persistentData.firstJoinMapGiven) return
  var level = player.level
  var map = FirstJoinMapItem.create(level, Math.floor(player.x), Math.floor(player.z), 0, true, false)
  var holder = FirstJoinAtlasUtils.findMapFromItemStack(level, map)
  if (!holder) throw new Error('图册地图初始化失败')
  var atlas = Item.of(FIRST_JOIN_COURIER.item)
  var maps = FirstJoinMapAtlasItem.getMaps(atlas, level)
  FirstJoinMapAtlasItem.setSelectedSlice(atlas, holder.slice, level)
  var initialized = maps['addAndAssigns(net.minecraft.world.item.ItemStack,net.minecraft.world.level.Level,pepjebs.mapatlases.utils.MapType,net.minecraft.world.level.saveddata.maps.MapId)'](atlas, level, holder.type, holder.id)
  if (initialized.getCount() !== 1) throw new Error('图册地图写入失败')
  player.give(atlas)
  player.persistentData.firstJoinMapGiven = true
}

function firstJoinQueueCourier(player, preview) {
  var id = player.uuid.toString()
  if ((!preview && player.persistentData.firstJoinMapGiven) || firstJoinDeliveries.has(id)) return
  firstJoinDeliveries.set(id, { player: player, preview: !!preview, ticks: 0, chaseTicks: 0, stage: 'waiting', pigeon: null })
}

function firstJoinRemoveCourier(id) {
  var delivery = firstJoinDeliveries.get(id)
  if (delivery && delivery.pigeon) delivery.pigeon.discard()
  firstJoinDeliveries.delete(id)
}

function firstJoinPoint(entity) {
  return { x: entity.x, y: entity.y, z: entity.z }
}

function firstJoinDistanceSquared(a, b) {
  return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2)
}

function firstJoinDirection(yaw) {
  var radians = yaw * Math.PI / 180
  return { x: -Math.sin(radians), z: Math.cos(radians) }
}

function firstJoinSampleHidden(player, eye, point) {
  var dx = point.x - eye.x
  var dy = point.y - eye.y
  var dz = point.z - eye.z
  var target = new FirstJoinVec3(point.x, point.y, point.z)
  var cursor = eye
  var previousProgress = 0
  for (var step = 0; step < 32; step++) {
    var hit = player.level.clip(new FirstJoinClipContext(
      cursor, target, FirstJoinClipBlock.VISUAL, FirstJoinClipFluid.NONE, player
    ))
    if (hit.getType() !== FirstJoinHitType.BLOCK) return false
    var pos = hit.getBlockPos()
    if (player.level.getBlockState(pos).isSolidRender(player.level, pos)) return true
    var exits = []
    if (Math.abs(dx) > 0.000001) exits.push(((dx > 0 ? pos.x + 1 : pos.x) - eye.x) / dx)
    if (Math.abs(dy) > 0.000001) exits.push(((dy > 0 ? pos.y + 1 : pos.y) - eye.y) / dy)
    if (Math.abs(dz) > 0.000001) exits.push(((dz > 0 ? pos.z + 1 : pos.z) - eye.z) / dz)
    if (exits.length === 0) return false
    var progress = Math.min.apply(null, exits) + 0.00001
    if (progress >= 1 || progress <= previousProgress) return false
    previousProgress = progress
    cursor = new FirstJoinVec3(eye.x + dx * progress, eye.y + dy * progress, eye.z + dz * progress)
  }
  return false
}

function firstJoinPointHidden(delivery, point) {
  var player = delivery.player
  var pigeon = delivery.pigeon
  var eye = player.getEyePosition()
  var radius = pigeon.getBbWidth() / 2 + 0.35
  var height = pigeon.getBbHeight() + 0.2
  if (!firstJoinSampleHidden(player, eye, { x: point.x, y: point.y + height / 2, z: point.z })) return false
  for (var x = -1; x <= 1; x += 2) {
    for (var y = 0; y <= 1; y++) {
      for (var z = -1; z <= 1; z += 2) {
        if (!firstJoinSampleHidden(player, eye, {
          x: point.x + x * radius, y: point.y - 0.1 + y * height, z: point.z + z * radius
        })) return false
      }
    }
  }
  return true
}

function firstJoinAirPoint(pigeon, point) {
  var level = pigeon.level
  var pos = FirstJoinBlockPos.containing(point.x, point.y, point.z)
  if (point.y < level.getMinBuildHeight() || point.y + 1 >= level.getMaxBuildHeight()) return false
  if (!level.hasChunkAt(pos) || !level.getBlockState(pos).isAir()) return false
  var box = pigeon.getBoundingBox().move(point.x - pigeon.x, point.y - pigeon.y, point.z - pigeon.z)
  return level.noCollision(pigeon, box) && !level.containsAnyLiquid(box)
}

function firstJoinTargetPoints(delivery) {
  var player = delivery.player
  var pigeon = delivery.pigeon
  var points = []
  var turns = [0, 30, -30, 60, -60, 90, -90]
  for (var distance = 1.8; distance <= 3.01; distance += 0.6) {
    for (var i = 0; i < turns.length; i++) {
      var direction = firstJoinDirection(player.getYaw() + turns[i])
      var point = {
        x: Math.floor(player.x + direction.x * distance) + 0.5,
        y: Math.floor(player.y + 1.25) + 0.1,
        z: Math.floor(player.z + direction.z * distance) + 0.5
      }
      if (firstJoinAirPoint(pigeon, point)) points.push(point)
    }
    if (points.length >= 6) break
  }
  return points
}

function firstJoinReachablePath(pigeon, point) {
  var path = pigeon.getNavigation().createPath(point.x, point.y, point.z, 0)
  return path && path.canReach() ? path : null
}

function firstJoinNavigateToPlayer(delivery) {
  var pigeon = delivery.pigeon
  var targets = firstJoinTargetPoints(delivery)
  for (var i = 0; i < Math.min(targets.length, 6); i++) {
    var path = firstJoinReachablePath(pigeon, targets[i])
    if (path && pigeon.getNavigation().moveTo(path, FIRST_JOIN_COURIER.speed)) return true
  }
  return false
}

function firstJoinCreateCoverSearch(delivery, departing) {
  var player = delivery.player
  var radii = []
  var turns = [0]
  for (var angle = 5; angle <= 85; angle += 5) turns.push(angle, -angle)
  turns.push(89, -89)
  var start = departing ? FIRST_JOIN_COURIER.hiddenDistance : FIRST_JOIN_COURIER.distance
  for (var distance = start; distance <= FIRST_JOIN_COURIER.maxDistance; distance++) radii.push(distance)
  if (!departing) {
    for (var near = start - 1; near >= 6; near--) radii.push(near)
  }
  return {
    departing: departing, origin: firstJoinPoint(player), yaw: player.getYaw(),
    radii: radii, radiusIndex: 0, turnIndex: 0, heightIndex: 0, pathChecks: 0,
    turns: turns,
    heights: [1, 0, 2, -1, 3, 5, 8, 12], pending: null
  }
}

function firstJoinNextCoverPoint(search) {
  if (search.radiusIndex >= search.radii.length) return null
  var direction = firstJoinDirection(search.yaw + search.turns[search.turnIndex])
  var radius = search.radii[search.radiusIndex]
  var point = {
    x: Math.floor(search.origin.x + direction.x * radius) + 0.5,
    y: Math.floor(search.origin.y + search.heights[search.heightIndex]) + 0.1,
    z: Math.floor(search.origin.z + direction.z * radius) + 0.5
  }
  search.heightIndex++
  if (search.heightIndex >= search.heights.length) {
    search.heightIndex = 0
    search.turnIndex++
    if (search.turnIndex >= search.turns.length) {
      search.turnIndex = 0
      search.radiusIndex++
    }
  }
  var forward = firstJoinDirection(search.yaw)
  if ((point.x - search.origin.x) * forward.x + (point.z - search.origin.z) * forward.z < 0) return firstJoinNextCoverPoint(search)
  return point
}

function firstJoinSearchCover(delivery, search) {
  var pigeon = delivery.pigeon
  var candidates = 0
  var paths = 0
  var targets = search.departing ? [] : firstJoinTargetPoints(delivery)
  if (!search.departing && targets.length === 0) return { done: true, result: null }
  while (candidates < FIRST_JOIN_COURIER.searchCandidatesPerTick && paths < FIRST_JOIN_COURIER.searchPathsPerTick) {
    var pending = search.pending
    if (!pending) {
      var point = firstJoinNextCoverPoint(search)
      if (!point || search.pathChecks >= FIRST_JOIN_COURIER.maxPathChecks) return { done: true, result: null }
      candidates++
      if (search.departing && firstJoinDistanceSquared(point, delivery.player) < Math.pow(FIRST_JOIN_COURIER.hiddenDistance, 2)) continue
      if (!firstJoinAirPoint(pigeon, point) || !firstJoinPointHidden(delivery, point)) continue
      search.pending = { point: point, targetIndex: 0 }
      pending = search.pending
    }
    if (!search.departing && pending.targetIndex >= Math.min(targets.length, 2)) {
      search.pending = null
      continue
    }
    var target = search.departing ? pending.point : targets[pending.targetIndex]
    if (!search.departing) pigeon.setPosition(pending.point.x, pending.point.y, pending.point.z)
    var path = firstJoinReachablePath(pigeon, target)
    search.pathChecks++
    paths++
    if (path) return { done: true, result: { point: pending.point, path: path } }
    pending.targetIndex++
    if (search.departing || pending.targetIndex >= Math.min(targets.length, 2)) search.pending = null
  }
  return { done: false, result: null }
}

function firstJoinHoldCourier(pigeon) {
  pigeon.stopInPlace()
  pigeon.setNoAi(true)
  pigeon.setNoGravity(true)
  pigeon.setMotion(0, 0, 0)
}

function firstJoinBeginDeparture(delivery) {
  var pigeon = delivery.pigeon
  if (!delivery.exitSearch) delivery.exitSearch = firstJoinCreateCoverSearch(delivery, true)
  var search = firstJoinSearchCover(delivery, delivery.exitSearch)
  if (!search.done) return
  delivery.exitSearch = null
  if (!search.result) {
    delivery.nextCoverSearch = delivery.ticks + 80
    if (!delivery.end) firstJoinHoldCourier(pigeon)
    return
  }
  var exit = search.result
  pigeon.setNoAi(false)
  if (!pigeon.getNavigation().moveTo(exit.path, FIRST_JOIN_COURIER.departureSpeed)) {
    firstJoinHoldCourier(pigeon)
    delivery.end = null
    return false
  }
  delivery.end = exit.point
  delivery.nextCoverSearch = delivery.ticks + FIRST_JOIN_COURIER.repathTicks
  return true
}

function firstJoinFallback(delivery) {
  if (!delivery.preview) firstJoinGiveMap(delivery.player)
}

function firstJoinLeaveAfterDelivery(delivery) {
  delivery.pigeon.setHasMail(false)
  delivery.stage = 'departing'
  delivery.ticks = 0
  firstJoinBeginDeparture(delivery)
}

function firstJoinStartCourier(delivery) {
  var player = delivery.player
  var pigeon = player.level.createEntity('envelope:pigeon')
  if (!pigeon) throw new Error('无法创建 envelope:pigeon')
  delivery.pigeon = pigeon
  delivery.dimension = player.level.dimension.toString()
  delivery.yaw = player.getYaw()
  pigeon.removeAllGoals(function (goal) { return true })
  pigeon.setNoAi(false)
  pigeon.setNoGravity(true)
  pigeon.setInvulnerable(true)
  pigeon.setPersistenceRequired()
  pigeon.setCanPickUpLoot(false)
  pigeon.setService(true)
  pigeon.setHasMail(true)
  pigeon.addTag(FIRST_JOIN_COURIER.tag)
  var followRange = pigeon.getAttribute(FirstJoinAttributes.FOLLOW_RANGE)
  if (followRange) followRange.setBaseValue(FIRST_JOIN_COURIER.maxDistance + 16)
  delivery.spawnSearch = firstJoinCreateCoverSearch(delivery, false)
  delivery.stage = 'spawning'
  delivery.ticks = 0
  return true
}

function firstJoinFinishSpawn(delivery) {
  var player = delivery.player
  var pigeon = delivery.pigeon
  var search = firstJoinSearchCover(delivery, delivery.spawnSearch)
  if (!search.done) return true
  delivery.spawnSearch = null
  var entry = search.result
  if (!entry) {
    firstJoinFallback(delivery)
    return false
  }
  pigeon.setYaw(delivery.yaw + 180)
  pigeon.setYHeadRot(delivery.yaw + 180)
  pigeon.setOnGround(false)
  if (!player.level.addFreshEntity(pigeon)) throw new Error('信鸽生成被取消')
  if (!pigeon.getNavigation().moveTo(entry.path, FIRST_JOIN_COURIER.speed)) {
    firstJoinFallback(delivery)
    return false
  }
  delivery.stage = 'approaching'
  delivery.ticks = 0
  return true
}

function firstJoinCanHandoff(delivery) {
  return firstJoinDistanceSquared(delivery.pigeon, delivery.player) <= 10.24 &&
    delivery.pigeon.hasLineOfSight(delivery.player)
}

function firstJoinTickCourier(id, delivery) {
  var player = delivery.player
  if (!player.isAlive() || player.isRemoved()) {
    firstJoinRemoveCourier(id)
    return
  }
  delivery.ticks++
  if (delivery.stage === 'waiting') {
    if (delivery.ticks >= FIRST_JOIN_COURIER.delay && !firstJoinStartCourier(delivery)) firstJoinRemoveCourier(id)
    return
  }
  var pigeon = delivery.pigeon
  if (player.level.dimension.toString() !== delivery.dimension || !pigeon.isAlive() || pigeon.isRemoved()) {
    firstJoinRemoveCourier(id)
    if (!delivery.preview) firstJoinQueueCourier(player, false)
    return
  }
  if (delivery.stage === 'spawning') {
    if (!firstJoinFinishSpawn(delivery)) firstJoinRemoveCourier(id)
    return
  }
  if (delivery.stage === 'approaching') {
    delivery.chaseTicks++
    if (firstJoinCanHandoff(delivery)) {
      if (!delivery.preview) firstJoinGiveMap(player)
      player.level.getServer().runCommandSilent(
        'execute as ' + player.uuid.toString() + ' at @s run playsound minecraft:entity.item.pickup player @s ~ ~ ~ 0.7 1.1'
      )
      firstJoinLeaveAfterDelivery(delivery)
    } else if (delivery.chaseTicks >= FIRST_JOIN_COURIER.approachTimeout) {
      firstJoinFallback(delivery)
      firstJoinLeaveAfterDelivery(delivery)
    } else if (delivery.ticks % FIRST_JOIN_COURIER.repathTicks === 0) {
      firstJoinNavigateToPlayer(delivery)
    }
    return
  }
  if (delivery.ticks % 5 === 0 &&
      firstJoinDistanceSquared(pigeon, player) >= Math.pow(FIRST_JOIN_COURIER.hiddenDistance, 2) &&
      firstJoinPointHidden(delivery, firstJoinPoint(pigeon))) {
    firstJoinRemoveCourier(id)
    return
  }
  var interval = delivery.ticks >= FIRST_JOIN_COURIER.departureTimeout ? 40 : FIRST_JOIN_COURIER.repathTicks
  if (delivery.exitSearch || (delivery.ticks >= (delivery.nextCoverSearch || 0) && delivery.ticks % interval === 0 &&
      (!delivery.end || pigeon.getNavigation().isDone() || !firstJoinPointHidden(delivery, delivery.end)))) {
    firstJoinBeginDeparture(delivery)
  }
}

PlayerEvents.loggedIn(function (event) { firstJoinQueueCourier(event.player, false) })
PlayerEvents.respawned(function (event) {
  firstJoinRemoveCourier(event.player.uuid.toString())
  firstJoinQueueCourier(event.player, false)
})
PlayerEvents.loggedOut(function (event) { firstJoinRemoveCourier(event.player.uuid.toString()) })

EntityEvents.spawned('envelope:pigeon', function (event) {
  var pigeon = event.entity
  if (!pigeon.getTags().contains(FIRST_JOIN_COURIER.tag)) return
  var active = false
  firstJoinDeliveries.forEach(function (delivery) {
    if (delivery.pigeon && delivery.pigeon.uuid.toString() === pigeon.uuid.toString()) active = true
  })
  if (!active) event.cancel()
})

function firstJoinCleanupCouriers(server) {
  var oldCouriers = []
  server.getAllLevels().forEach(function (level) {
    level.getAllEntities().forEach(function (entity) {
      if (entity.getTags().contains(FIRST_JOIN_COURIER.tag)) oldCouriers.push(entity)
    })
  })
  oldCouriers.forEach(function (entity) { entity.discard() })
  firstJoinDeliveries.clear()
  server.players.forEach(function (player) { firstJoinQueueCourier(player, false) })
}

ServerEvents.tick(function (event) {
  if (firstJoinCourierCleanupNeeded) {
    firstJoinCleanupCouriers(event.server)
    firstJoinCourierCleanupNeeded = false
  }
  var pending = []
  firstJoinDeliveries.forEach(function (delivery, id) { pending.push({ id: id, delivery: delivery }) })
  pending.forEach(function (entry) {
    var delivery = entry.delivery
    try {
      firstJoinTickCourier(entry.id, delivery)
    } catch (error) {
      try {
        if (delivery.player.isAlive() && !delivery.player.isRemoved()) firstJoinFallback(delivery)
      } finally {
        firstJoinRemoveCourier(entry.id)
      }
    }
  })
})

ServerEvents.commandRegistry(function (event) {
  event.register(event.commands.literal('first_join_courier')
    .requires(function (source) { return source.hasPermission(2) })
    .executes(function (context) {
      var player = context.source.getPlayerOrException()
      firstJoinRemoveCourier(player.uuid.toString())
      firstJoinQueueCourier(player, true)
      return 1
    }))
})
