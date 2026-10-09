var LT_VILLAGE_BOUNTIES = {
  dataKey: 'lt_village_bounties_v1',
  criterion: 'letstogether:bounty_completed',
  objectiveId: 'lt_kingdoms_objs.complete_villager_quest',
  excludedQuests: ['letstogether:bounty_introduction', 'letstogether:bounty_service', 'letstogether:bounty_steward'],
  reputationPerBounty: 1,
  reputationPerDay: 5,
  witnessRadius: 16,
  questPollTicks: 20
}

;(function () {
  if (!Platform.isLoaded('bountiful') || !Platform.isLoaded('villagerretaliation')) return
  var LTVBQuestApi = Java.loadClass('com.jvn.villagerretaliation.api.QuestCriterionApi')
  var LTVBQuestData = Java.loadClass('com.jvn.villagerretaliation.quest.VillagerQuestSavedData')
  var LTVBReputation = Java.loadClass('com.jvn.villagerretaliation.reputation.VillagerReputationManager')
  var LTVBBountyStats = Java.loadClass('io.ejekta.bountiful.content.BountifulContent$CustomStats')
  var LTVBBountyStack = Java.loadClass('io.ejekta.bountiful.components.BountyStack')
  var LTVBDecreeStack = Java.loadClass('io.ejekta.bountiful.components.DecreeStack')
  var LTVBResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
  var LTVBVillager = Java.loadClass('net.minecraft.world.entity.npc.Villager')
  var LTVBCompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
  var LTVBHashMap = Java.loadClass('java.util.HashMap')
  var LTVBHashSet = Java.loadClass('java.util.HashSet')
  var ltvbCriterion = LTVBResourceLocation.parse(LT_VILLAGE_BOUNTIES.criterion)
  var ltvbPlayers = new Map()

  function ltvbData(player) {
    var root = player.persistentData
    if (!root.contains(LT_VILLAGE_BOUNTIES.dataKey)) root.put(LT_VILLAGE_BOUNTIES.dataKey, new LTVBCompoundTag())
    var data = root.getCompound(LT_VILLAGE_BOUNTIES.dataKey)
    var day = Math.floor(player.serverLevel().getServer().overworld().getGameTime() / 24000)
    if (!data.contains('reputationDay') || data.getLong('reputationDay') !== day) {
      data.putLong('reputationDay', day)
      data.putInt('reputationToday', 0)
    }
    return data
  }

  function ltvbBountyCount(player) {
    return player.stats['get(net.minecraft.stats.Stat)'](LTVBBountyStats.INSTANCE.getBOUNTIES_COMPLETED())
  }

  function ltvbQuestCounts(player) {
    var counts = new Map()
    LTVBQuestData.get(player.serverLevel()).progress(player.uuid).forEach(function (entry) {
      var id = entry.getKey().toString()
      if (LT_VILLAGE_BOUNTIES.excludedQuests.indexOf(id) < 0) counts.set(id, entry.getValue().completionCount())
    })
    return counts
  }

  function ltvbBaseline(player) {
    var state = { bounties: ltvbBountyCount(player), quests: ltvbQuestCounts(player), ticks: 0, failed: false }
    ltvbPlayers.set(player.uuid.toString(), state)
    return state
  }

  function ltvbReputation(player) {
    var level = player.serverLevel()
    var data = ltvbData(player)
    var remaining = LT_VILLAGE_BOUNTIES.reputationPerDay - data.getInt('reputationToday')
    if (remaining <= 0 || LT_VILLAGE_BOUNTIES.reputationPerBounty <= 0) return
    var witness = null
    var nearest = LT_VILLAGE_BOUNTIES.witnessRadius * LT_VILLAGE_BOUNTIES.witnessRadius
    level.getEntitiesOfClass(LTVBVillager, player.getBoundingBox().inflate(LT_VILLAGE_BOUNTIES.witnessRadius)).forEach(function (villager) {
      if (!villager.isAlive() || villager.isBaby()) return
      var distance = villager.distanceToEntitySqr(player)
      if (distance <= nearest) { witness = villager; nearest = distance }
    })
    if (!witness) return
    var amount = Math.min(remaining, LT_VILLAGE_BOUNTIES.reputationPerBounty)
    data.putInt('reputationToday', data.getInt('reputationToday') + amount)
    LTVBReputation.addDialogueReputation(level, witness, player, amount)
  }

  function ltvbPublishBounty(player) {
    var payload = new LTVBHashMap()
    payload.put('source', 'bountiful')
    LTVBQuestApi['trigger(net.minecraft.server.level.ServerPlayer,net.minecraft.resources.ResourceLocation,java.util.Map)'](
      player, ltvbCriterion, payload
    )
    ltvbReputation(player)
  }

  function ltvbAdvanceBounties(player, completedTimes) {
    var changed = false
    var inventory = player.inventory
    for (var slot = 0; slot < inventory.getSlots(); slot++) {
      var stack = inventory.getStackInSlot(slot)
      if (stack.id !== 'bountiful:bounty') continue
      var bounty = new LTVBBountyStack(stack)
      if (bounty.getInfo().timeLeftTicks(player.serverLevel()) <= 0) continue
      var completed = 0
      completedTimes.forEach(function (time) {
        if (time >= bounty.getInfo().timePickedUp()) completed++
      })
      if (completed === 0) continue
      bounty.getObjs().forEach(function (objective) {
        if (objective.getId() !== LT_VILLAGE_BOUNTIES.objectiveId) return
        var increment = Math.min(completed, Math.max(0, objective.getAmount() - bounty.progressOf(objective)))
        for (var count = 0; count < increment; count++) {
          bounty['advance(io.ejekta.bountiful.components.BountyDataEntry)'](objective)
          changed = true
        }
      })
      bounty.checkForCompletionAndAlert(player)
    }
    if (changed) player.sendInventoryUpdate()
  }

  function ltvbPoll(player, state) {
    var current = ltvbBountyCount(player)
    var delta = Math.max(0, current - state.bounties)
    state.bounties = current
    for (var bounty = 0; bounty < delta; bounty++) ltvbPublishBounty(player)
    state.ticks++
    if (state.ticks % LT_VILLAGE_BOUNTIES.questPollTicks !== 0) return
    var quests = ltvbQuestCounts(player)
    var completedTimes = []
    var questData = LTVBQuestData.get(player.serverLevel())
    quests.forEach(function (count, id) {
      var previous = state.quests.get(id) || 0
      if (count <= previous) return
      questData.get(player.uuid, LTVBResourceLocation.parse(id)).completionHistory().forEach(function (completion) {
        if (completion.completionIndex() > previous && completion.completionIndex() <= count) {
          completedTimes.push(completion.completedGameTime())
        }
      })
    })
    state.quests = quests
    if (completedTimes.length > 0) ltvbAdvanceBounties(player, completedTimes)
  }

  PlayerEvents.loggedIn(function (event) { ltvbBaseline(event.player) })
  PlayerEvents.loggedOut(function (event) { ltvbPlayers.delete(event.player.uuid.toString()) })
  PlayerEvents.tick(function (event) {
    var player = event.player
    var state = ltvbPlayers.get(player.uuid.toString())
    if (!state) { ltvbBaseline(player); return }
    if (state.failed) return
    try {
      ltvbPoll(player, state)
    } catch (error) {
      state.failed = true
    }
  })

  ServerEvents.commandRegistry(function (event) {
    event.register(event.commands.literal('village_bounties')
      .executes(function (context) {
        var player = context.source.getPlayerOrException()
        var data = ltvbData(player)
        var state = ltvbPlayers.get(player.uuid.toString())
        player.tell('村庄委托：向成年村民接取“赏金板上的第一份委托”，交付赏金后回去复命。')
        player.tell('完成王国原有任务可推进背包里的“完成村民委托”赏金。今日额外声望：' +
          data.getInt('reputationToday') + '/' + LT_VILLAGE_BOUNTIES.reputationPerDay +
          (state && state.failed ? '；联动已暂停，请重载脚本或重新登录。' : ''))
        return 1
      })
      .then(event.commands.literal('decree')
        .requires(function (source) { return source.hasPermission(2) })
        .executes(function (context) {
          var player = context.source.getPlayerOrException()
          var stack = Item.of('bountiful:decree')
          var decree = new LTVBDecreeStack(stack)
          var ids = new LTVBHashSet()
          ids.add('lt_kingdoms')
          decree.setIds(ids)
          decree.setRank(1)
          player.give(stack)
          return 1
        })))
  })
})()
