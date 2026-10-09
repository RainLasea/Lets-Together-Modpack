const $VanillaTutorialSteps = Java.loadClass('net.minecraft.client.tutorial.TutorialSteps')

ClientEvents.loggedIn(event => {
  event.client.options.hideBundleTutorial = true
  event.client.getTutorial().setStep($VanillaTutorialSteps.NONE)
})
