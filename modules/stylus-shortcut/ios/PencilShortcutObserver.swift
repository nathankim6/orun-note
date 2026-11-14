import UIKit

/// No touch recognizers: Pencil side gestures cannot cancel finger/palm navigation.
@MainActor
final class PencilShortcutObserver: NSObject, UIPencilInteractionDelegate {
  private var interaction: UIPencilInteraction?
  private let emit: ([String: Any]) -> Void
  init(emit: @escaping ([String: Any]) -> Void) { self.emit = emit }

  func attach(to view: UIView) {
    if interaction?.view === view { return }
    detach()
    let pencil = UIPencilInteraction()
    pencil.delegate = self
    view.addInteraction(pencil)
    interaction = pencil
  }
  func detach() {
    if let pencil = interaction {
      pencil.isEnabled = false
      pencil.view?.removeInteraction(pencil)
      pencil.delegate = nil
    }
    interaction = nil
  }
  private func send(_ kind: String, location: CGPoint? = nil) {
    guard let pencil = interaction, pencil.isEnabled,
          let view = pencil.view, let window = view.window,
          window.isKeyWindow, UIApplication.shared.applicationState == .active else { return }
    var body: [String: Any] = ["kind": kind]
    if let location = location {
      let inWindow = view.convert(location, to: window)
      let point = window.convert(inWindow, to: window.screen.coordinateSpace)
      body["x"] = point.x
      body["y"] = point.y
    }
    emit(body)
  }
  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    guard UIPencilInteraction.preferredTapAction != .ignore else { return }
    send("pencil-double-tap")
  }
  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    guard UIPencilInteraction.preferredTapAction != .ignore,
          UIPencilInteraction.preferredTapAction != .runSystemShortcut else { return }
    send("pencil-double-tap", location: tap.hoverPose?.location)
  }
  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    guard squeeze.phase == .ended,
          UIPencilInteraction.preferredSqueezeAction != .ignore,
          UIPencilInteraction.preferredSqueezeAction != .runSystemShortcut else { return }
    send("pencil-squeeze", location: squeeze.hoverPose?.location)
  }
}
