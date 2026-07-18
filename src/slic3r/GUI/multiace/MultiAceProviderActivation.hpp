#ifndef slic3r_MultiAceProviderActivation_hpp_
#define slic3r_MultiAceProviderActivation_hpp_

#include "../DeviceManager.hpp"
#include "MultiAceProviderConfig.hpp"

#include <utility>

namespace Slic3r::MultiAce {

inline MultiAceMachineBinding& activate_multiace_web_provider(DeviceManager&                    device_manager,
                                                              MachineObject&                    machine,
                                                              const ProviderActivationConfig&   config,
                                                              DeviceManager::MultiAceDispatcher dispatcher = {})
{
    auto provider_factory = [&config] { return create_started_multiace_web_provider(config); };

    auto attach = [&device_manager, &machine, &dispatcher](const auto& provider) -> MultiAceMachineBinding& {
        return device_manager.attach_multiace_provider(machine, provider, std::move(dispatcher));
    };

    return activate_multiace_provider(provider_factory, attach);
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceProviderActivation_hpp_
