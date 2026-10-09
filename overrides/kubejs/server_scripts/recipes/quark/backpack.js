ServerEvents.recipes(event => {
  event.remove({ id: 'quark:oddities/crafting/backpack' })

  event.shaped(
    Item.of('quark:backpack', 1),
    [
      'LLL',
      'LCL',
      'LIL'
    ],
    {
      L: 'minecraft:leather',
      I: 'minecraft:iron_ingot',
      C: '#c:chests/wooden'
    }
  ).id('quark:oddities/crafting/backpack')
})