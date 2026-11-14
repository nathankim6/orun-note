import ExpoModulesCore
import UIKit

public class StylusShortcutModule: Module {
  // All state access is serialized on main, including module observation hooks.
  private var observing = false
  private var observer: PencilShortcutObserver?
  public func definition() -> ModuleDefinition {
    Name("StylusShortcut")
    Events("onStylusShortcut")
    OnStartObserving { [weak self] in
      DispatchQueue.main.async { self?.observing = true; self?.attach() }
    }
    OnStopObserving { [weak self] in
      DispatchQueue.main.async { self?.observing = false; self?.detach() }
    }
    OnAppBecomesActive { [weak self] in
      DispatchQueue.main.async { if self?.observing == true { self?.attach() } }
    }
    OnAppEntersBackground { [weak self] in
      DispatchQueue.main.async { self?.detach() }
    }
    OnDestroy { [weak self] in
      guard let self = self else { return }
      // Serialize after any queued start so a pending attach cannot escape cleanup.
      DispatchQueue.main.async { self.observing = false; self.detach() }
    }
  }
  @MainActor private func attach() {
    guard observing, let view = appContext?.utilities?.currentViewController()?.view else { return }
    if observer == nil {
      observer = PencilShortcutObserver { [weak self] body in self?.sendEvent("onStylusShortcut", body) }
    }
    observer?.attach(to: view)
  }
  @MainActor private func detach() { observer?.detach(); observer = nil }
}
